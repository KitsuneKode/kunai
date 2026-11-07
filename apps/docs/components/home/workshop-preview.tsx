"use client";

import type { WorkshopProject } from "@/lib/workshop";
import Image from "next/image";
import { useState } from "react";

/** Fixed geometry and a readable fallback, including when an image fails. */
export function WorkshopPreview({
  project,
  compact = false,
}: {
  readonly project: WorkshopProject;
  readonly compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const preview = project.preview;
  return (
    <div className="kunai-workshop-preview">
      {"image" in preview && !failed ? (
        <Image
          src={preview.image}
          alt={preview.alt}
          width={640}
          height={344}
          sizes={compact ? "320px" : "(max-width: 639px) 90vw, (max-width: 1023px) 45vw, 340px"}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="kunai-workshop-preview__terminal">
          <span>{"code" in preview ? preview.label : project.name}</span>
          <pre>
            {"code" in preview
              ? preview.code
              : "Image unavailable.\nVisit the project to explore it."}
          </pre>
        </div>
      )}
    </div>
  );
}
