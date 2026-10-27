"use client";

/** Decorative signature; real navigation above stays the only interactive layer. */
export function FooterWordmark() {
  return (
    <div
      className="kunai-footer-wordmark"
      aria-hidden="true"
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--wordmark-x", `${event.clientX - bounds.left}px`);
        event.currentTarget.style.setProperty("--wordmark-y", `${event.clientY - bounds.top}px`);
      }}
    >
      <span>kunai</span>
      <span className="kunai-footer-wordmark__light">kunai</span>
    </div>
  );
}
