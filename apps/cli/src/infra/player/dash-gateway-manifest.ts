import { DOMParser, Element, onWarningStopParsing, XMLSerializer, type Node } from "@xmldom/xmldom";

const DASH_NAMESPACE = "urn:mpeg:dash:schema:mpd:2011";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const SEGMENT_ELEMENTS = new Set(["SegmentTemplate", "SegmentList", "SegmentBase"]);
const URL_ATTRIBUTES = new Map<string, readonly string[]>([
  ["SegmentTemplate", ["media", "initialization", "index", "bitstreamSwitching"]],
  ["SegmentURL", ["media", "index"]],
  ["Initialization", ["sourceURL"]],
  ["RepresentationIndex", ["sourceURL"]],
  ["BitstreamSwitching", ["sourceURL"]],
]);
const MAX_ELEMENTS = 20_000;

export class UnsupportedDashManifestError extends Error {
  override readonly name = "UnsupportedDashManifestError";
  constructor() {
    super("unsupported DASH manifest");
  }
}

function children(node: Node): Element[] {
  const elements: Element[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child instanceof Element) elements.push(child);
  }
  return elements;
}

function name(element: Element): string {
  return element.localName ?? element.tagName;
}

function resolveUrl(raw: string, base?: string): string {
  try {
    return new URL(raw.trim(), base).href;
  } catch {
    throw new UnsupportedDashManifestError();
  }
}

function scopedBase(element: Element, inherited?: string): string | undefined {
  const xmlBase = element.getAttributeNS(XML_NAMESPACE, "base");
  if (!xmlBase) return inherited;
  element.removeAttributeNS(XML_NAMESPACE, "base");
  return resolveUrl(xmlBase, inherited);
}

/** Flatten inherited segment addressing at each representation before rewriting its URLs. */
function mergedSegments(chain: readonly Element[]): Element | undefined {
  const first = chain[0];
  if (!first) return undefined;
  const merged = first.cloneNode(true);
  if (!(merged instanceof Element)) throw new UnsupportedDashManifestError();
  for (const override of chain.slice(1)) {
    for (const attr of Array.from(override.attributes)) {
      merged.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    }
    const overriddenNames = new Set(children(override).map(name));
    for (const previous of children(merged)) {
      if (overriddenNames.has(name(previous))) merged.removeChild(previous);
    }
    for (const child of children(override)) merged.appendChild(child.cloneNode(true));
  }
  return merged;
}

export function rewriteDashManifest(input: {
  readonly text: string;
  readonly manifestUrl?: string;
  readonly rewriteUrl: (url: string) => string;
}): string {
  // No DTD/entity expansion or out-of-band XML resources are part of playback.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(input.text)) throw new UnsupportedDashManifestError();
  let document;
  try {
    document = new DOMParser({ onError: onWarningStopParsing }).parseFromString(
      input.text,
      "application/xml",
    );
  } catch {
    throw new UnsupportedDashManifestError();
  }
  const root = document.documentElement;
  if (
    !root ||
    name(root) !== "MPD" ||
    (root.namespaceURI && root.namespaceURI !== DASH_NAMESPACE)
  ) {
    throw new UnsupportedDashManifestError();
  }
  const pending: Array<{
    node: Element;
    base?: string;
    xmlBase?: string;
    segments: readonly Element[];
  }> = [{ node: root, base: input.manifestUrl, xmlBase: input.manifestUrl, segments: [] }];
  // Validate the original tree, including nodes detached or skipped by the
  // addressing pass (BaseURL, Location, and inherited segment elements).
  const original = [root];
  let originalElements = 0;
  while (original.length > 0) {
    const element = original.pop();
    if (!element) break;
    if (
      ++originalElements > MAX_ELEMENTS ||
      ["ContentProtection", "UTCTiming", "PatchLocation"].includes(name(element)) ||
      Array.from(element.attributes).some((attr) => attr.localName === "href")
    ) {
      throw new UnsupportedDashManifestError();
    }
    original.push(...children(element));
  }
  let visited = 0;
  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame) break;
    const { node } = frame;
    if (++visited > MAX_ELEMENTS) throw new UnsupportedDashManifestError();
    const nodeName = name(node);
    const ownXmlBase = node.getAttributeNS(XML_NAMESPACE, "base");
    const xmlBase = scopedBase(node, frame.xmlBase);
    let base = ownXmlBase ? xmlBase : frame.base;
    const bases = children(node).filter((child) => name(child) === "BaseURL");
    // Choosing one alternative silently would change the player's request contract.
    if (bases.length > 1) throw new UnsupportedDashManifestError();
    const baseNode = bases[0];
    if (baseNode) {
      const ownBase = baseNode.getAttributeNS(XML_NAMESPACE, "base");
      base = resolveUrl(baseNode.textContent ?? "", ownBase ? scopedBase(baseNode, xmlBase) : base);
      baseNode.textContent = input.rewriteUrl(base);
    }
    let segments = frame.segments;
    if (["MPD", "Period", "AdaptationSet", "Representation"].includes(nodeName)) {
      const local = children(node).filter((child) => SEGMENT_ELEMENTS.has(name(child)));
      if (local.length > 1) throw new UnsupportedDashManifestError();
      const own = local[0];
      if (own) {
        segments = segments[0] && name(segments[0]) === name(own) ? [...segments, own] : [own];
        node.removeChild(own);
      }
      if (nodeName === "Representation") {
        const merged = mergedSegments(segments);
        if (merged) node.appendChild(merged);
        segments = [];
      }
    }
    for (const attribute of URL_ATTRIBUTES.get(nodeName) ?? []) {
      const raw = node.getAttribute(attribute);
      if (raw) node.setAttribute(attribute, input.rewriteUrl(resolveUrl(raw, base)));
    }
    for (const child of children(node).reverse()) {
      if (name(child) === "BaseURL") continue;
      if (name(child) === "Location") {
        child.textContent = input.rewriteUrl(
          resolveUrl(child.textContent ?? "", scopedBase(child, xmlBase)),
        );
        continue;
      }
      pending.push({ node: child, base, xmlBase, segments });
    }
  }
  return new XMLSerializer().serializeToString(document);
}

export type DashTemplate = {
  readonly url: string;
  readonly variables: readonly { token: string; numeric: boolean }[];
};

/** Template variables remain visible in the player URL; only registered substitutions can be fetched. */
export function parseDashTemplate(url: string): DashTemplate {
  const variables = new Map<string, { token: string; numeric: boolean }>();
  for (let index = 0; index < url.length; index++) {
    if (url[index] !== "$") continue;
    if (url[index + 1] === "$") {
      index++;
      continue;
    }
    const match = /^\$(RepresentationID|Number|Time|Bandwidth)(?:%0([1-9]\d?)d)?\$/.exec(
      url.slice(index),
    );
    if (
      !match?.[0] ||
      !match[1] ||
      (match[1] === "RepresentationID" && match[2]) ||
      (match[2] && Number(match[2]) > 32)
    )
      throw new UnsupportedDashManifestError();
    variables.set(match[0], { token: match[0], numeric: match[1] !== "RepresentationID" });
    index += match[0].length - 1;
  }
  if (variables.size > 8 || new URL(url).origin.includes("$"))
    throw new UnsupportedDashManifestError();
  return { url, variables: [...variables.values()] };
}

export function substituteDashTemplate(
  template: DashTemplate,
  values: readonly string[],
): string | undefined {
  if (values.length !== template.variables.length) return undefined;
  const substitutions = new Map<string, string>();
  for (let index = 0; index < values.length; index++) {
    const variable = template.variables[index];
    const value = values[index];
    if (
      !variable ||
      !value ||
      !(variable.numeric ? /^\d{1,32}$/ : /^[A-Za-z0-9_.-]{1,128}$/).test(value)
    )
      return undefined;
    substitutions.set(variable.token, encodeURIComponent(value));
  }
  return template.url.replace(
    /\$\$|\$(?:RepresentationID|Number|Time|Bandwidth)(?:%0[1-9]\d?d)?\$/g,
    (token) => (token === "$$" ? "$" : (substitutions.get(token) ?? "")),
  );
}
