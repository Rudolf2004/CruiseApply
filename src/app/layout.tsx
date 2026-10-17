import type { Metadata } from "next";
import "@fontsource/tinos/latin-400.css";
import "@fontsource/tinos/latin-700.css";
import "@fontsource/tinos/latin-400-italic.css";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "CruiseApply — Build Your Career Beyond Borders", template: "%s | CruiseApply" },
  description: "Independent cruise career discovery and application support. Explore opportunities and manage your career journey."
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><a href="#main" className="skip-link">Skip to content</a>{children}</body></html>;
}
