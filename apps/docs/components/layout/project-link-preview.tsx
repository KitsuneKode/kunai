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
        delay={500}
        closeDelay={200}
        className="kunai-project-link text-fd-muted-foreground text-sm"
      >
        {project.name}
        <span className="sr-only"> (opens in a new tab)</span>
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side="top"
          align="start"
          sideOffset={12}
          collisionPadding={16}
          className="kunai-project-preview-positioner"
        >
          <PreviewCard.Popup className="kunai-project-preview">
            <WorkshopPreview project={project} compact />
            <div className="kunai-project-preview__copy">
              <p className="kunai-project-preview__name">{project.name}</p>
              <p>{project.tagline}</p>
              <span>{new URL(href).hostname}</span>
            </div>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
