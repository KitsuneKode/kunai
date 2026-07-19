import { Cormorant_Garamond, JetBrains_Mono, Outfit } from "next/font/google";

export const fontSans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const fontSerif = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const fontClassNames = [fontSans.variable, fontSerif.variable, fontMono.variable].join(" ");
