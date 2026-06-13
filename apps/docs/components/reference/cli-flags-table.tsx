import { codeMetadata } from "../../lib/code-metadata";

export function CliFlagsTable() {
  return (
    <div className="not-prose overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">Flag</th>
            <th className="py-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {codeMetadata.cliOptions.map((flag) => (
            <tr key={flag.long} className="border-fd-border/50 border-b align-top">
              <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                {flag.short ? (
                  <>
                    <span>{flag.short}</span>,{" "}
                  </>
                ) : null}
                {flag.long}
              </td>
              <td className="py-2 text-xs leading-relaxed">{flag.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
