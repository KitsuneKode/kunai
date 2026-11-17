import { Box as InkBox, Text as InkText, type DOMElement } from "ink";
import React, { forwardRef, type ComponentProps } from "react";

import { stripInkColorProps } from "./shell-color";

type TextProps = ComponentProps<typeof InkText>;
type BoxProps = ComponentProps<typeof InkBox>;

export const Text = (props: TextProps) => <InkText {...stripInkColorProps(props)} />;

export const Box = forwardRef<DOMElement, BoxProps>(function ShellBox(props, ref) {
  return <InkBox ref={ref} {...stripInkColorProps(props)} />;
});
