import { KunaiFox } from "@/components/brand/kunai-fox";

export function NavTitle() {
  return (
    <span className="kunai-nav-title text-fd-foreground inline-flex items-center gap-2.5 transition-colors select-none">
      {/* `compact` loads the 96px nav still: the pose masters are corner-cropped
          and collapse into a smudge at this size. */}
      <KunaiFox pose="idle" size={28} compact />
      <span className="kunai-nav-wordmark text-[1.05rem] font-medium tracking-tight">Kunai</span>
    </span>
  );
}
