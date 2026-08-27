import { KunaiFox } from "@/components/brand/kunai-fox";

export function NavTitle() {
  return (
    <span className="text-fd-foreground inline-flex items-center gap-2.5 transition-colors select-none">
      <KunaiFox pose="idle" size={28} />
      <span className="kunai-nav-wordmark text-[1.05rem] font-medium tracking-tight">Kunai</span>
    </span>
  );
}
