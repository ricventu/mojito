import "./globals.css";
import type { ReactNode } from "react";
import SwRegister from "@/components/SwRegister";

// No static `title`: the document title is owned entirely on the client (see the
// effect in page.tsx and terminalTabTitle in TerminalView) so it can reflect the
// active tab / open terminal. A static metadata title would be applied once at
// hydration and clobber that. The installed-app name comes from the manifest.
export const metadata = { manifest: "/manifest.webmanifest" };
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  // Ask supporting browsers (Chromium) to shrink the layout viewport when the
  // virtual keyboard opens so `100dvh` reflects the space above it. iOS Safari
  // ignores this; the visualViewport handler in TerminalView is the actual fix.
  interactiveWidget: "resizes-content" as const,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
