import { MotionProvider } from "@/components/providers/motion-provider";
import { homeLayoutOptions } from "@/lib/layout.shared";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

export default function Layout({ children }: { readonly children: ReactNode }) {
  return (
    <MotionProvider>
      <HomeLayout {...homeLayoutOptions()}>{children}</HomeLayout>
    </MotionProvider>
  );
}
