import React, { createContext, useContext } from "react";

import { MouseTarget } from "../mouse/MouseRegions";

export type SetupPointerActions = {
  readonly pick: (field: "mode" | "lane" | "audio" | "subtitle" | "library", value: string) => void;
  readonly action: (key: string) => void;
};
export const SetupPointerContext = createContext<SetupPointerActions | null>(null);

export function SetupTarget({
  field,
  value,
  children,
}: {
  readonly field: Parameters<SetupPointerActions["pick"]>[0] | "action";
  readonly value: string;
  readonly children: React.ReactNode;
}) {
  const actions = useContext(SetupPointerContext);
  return (
    <MouseTarget
      id={`setup:${field}:${value}`}
      active={actions !== null}
      onClick={() => {
        if (field === "action") actions?.action(value);
        else actions?.pick(field, value);
      }}
    >
      {children}
    </MouseTarget>
  );
}
