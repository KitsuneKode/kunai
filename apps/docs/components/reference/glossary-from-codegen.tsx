import { codeMetadata } from "@/lib/code-metadata";

export function GlossaryFromCodegen() {
  const commandTerms = codeMetadata.commands.map((command) => ({
    term: `/${command.id}`,
    definition: command.description || command.label,
  }));

  const flagTerms = codeMetadata.cliOptions.map((option) => ({
    term: option.long,
    definition: option.description,
  }));

  const featureTerms = codeMetadata.featureStatus.map((feature) => ({
    term: feature.label,
    definition: `${feature.status}: ${feature.description}`,
  }));

  const terms = [...commandTerms, ...flagTerms, ...featureTerms].sort((a, b) =>
    a.term.localeCompare(b.term),
  );

  return (
    <dl className="not-prose grid gap-4">
      {terms.map((entry) => (
        <div key={entry.term} className="border-fd-border border-b pb-4 last:border-0">
          <dt className="font-mono text-sm font-medium">{entry.term}</dt>
          <dd className="text-fd-muted-foreground mt-1 text-sm leading-relaxed">
            {entry.definition}
          </dd>
        </div>
      ))}
    </dl>
  );
}
