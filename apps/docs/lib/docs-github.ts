const REPO = "https://github.com/KitsuneKode/kunai";

export function docsEditUrl(path: string): string {
  return `${REPO}/edit/main/docs/${path}`;
}

export function docsViewUrl(path: string): string {
  return `${REPO}/blob/main/docs/${path}`;
}
