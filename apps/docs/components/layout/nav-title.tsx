export function NavTitle() {
  return (
    <span className="text-fd-foreground inline-flex items-center gap-2.5 transition-colors select-none">
      <span
        aria-hidden
        className="bg-fd-primary text-fd-primary-foreground flex size-7 items-center justify-center rounded-lg text-xs font-bold tracking-tighter shadow-[var(--kunai-shadow-sm)] ring-1 ring-white/10"
      >
        K
      </span>
      <span className="kunai-nav-wordmark text-[1.05rem] font-medium tracking-tight">Kunai</span>
    </span>
  );
}
