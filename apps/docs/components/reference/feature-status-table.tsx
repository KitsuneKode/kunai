import { Badge } from "@/components/ui/badge";
import { codeMetadata } from "@/lib/code-metadata";

const statusVariant = {
  shipped: "ok",
  beta: "accent",
  planned: "muted",
} as const;

export function FeatureStatusTable() {
  return (
    <div className="not-prose border-fd-border overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-fd-border bg-fd-muted/30 border-b">
            <th className="px-4 py-2 font-medium">Capability</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {codeMetadata.featureStatus.map((feature) => (
            <tr key={feature.id} className="border-fd-border border-b last:border-0">
              <td className="px-4 py-2 font-medium">{feature.label}</td>
              <td className="px-4 py-2">
                <Badge variant={statusVariant[feature.status]} className="capitalize">
                  {feature.status}
                </Badge>
              </td>
              <td className="text-fd-muted-foreground px-4 py-2">{feature.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
