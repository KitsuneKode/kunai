"use client";

import { WorkshopPreview } from "@/components/home/workshop-preview";
import type { WorkshopProject } from "@/lib/workshop";
import { PreviewCard } from "@base-ui/react/preview-card";

/** Supplementary visual preview; the native link remains the whole interaction. */
export function ProjectLinkPreview({ project }: { readonly project: WorkshopProject }) {
  const href = project.siteUrl ?? project.repoUrl;
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        delay={220}
        closeDelay={160}
        className="kunai-project-link text-fd-muted-foreground text-sm"
      >
        {project.name}
        <span className="sr-only"> (opens in a new tab)</span>
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={16}
          className="kunai-project-preview-positioner"
        >
          <PreviewCard.Popup className="kunai-project-preview">
            <WorkshopPreview project={project} compact />
            <div className="kunai-project-preview__copy">
              <div className="kunai-project-preview__head">
                <p className="kunai-project-preview__name">{project.name}</p>
                <span className="kunai-project-preview__kind">{project.kind}</span>
              </div>
              <p className="kunai-project-preview__tagline">{project.tagline}</p>
              <span className="kunai-project-preview__host">{new URL(href).hostname}</span>
            </div>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
