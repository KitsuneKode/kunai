type DocsHubIntroProps = {
  readonly pill?: string;
  readonly lead: string;
  readonly sublead?: string;
};

export function DocsHubIntro({ pill = "Kunai documentation", lead, sublead }: DocsHubIntroProps) {
  return (
    <div className="kunai-docs-hub-intro not-prose">
      <p className="kunai-type-caption mb-3">{pill}</p>
      <p className="kunai-type-lead text-fd-foreground m-0 max-w-none font-medium">{lead}</p>
      {sublead ? <p className="kunai-type-body mt-3 mb-0">{sublead}</p> : null}
    </div>
  );
}
