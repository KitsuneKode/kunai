import { KunaiHomeLayout } from "@/components/layout/kunai-home-layout";
import type { ReactNode } from "react";

export default function PrivacyLayout({ children }: { readonly children: ReactNode }) {
  return <KunaiHomeLayout>{children}</KunaiHomeLayout>;
}
