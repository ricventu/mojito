import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import SwRegister from "@/components/SwRegister";

// No static `title`: the document title is owned entirely on the client (see the
// effect in page.tsx and terminalTabTitle in TerminalView) so it can reflect the
// active tab / open terminal. A static metadata title would be applied once at
// hydration and clobber that. The installed-app name comes from the manifest.
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  // iOS reads none of the manifest's icons for the home screen — it wants an
  // apple-touch-icon link and a PNG behind it (public/apple-touch-icon.png, cut
  // from icon.svg by scripts/gen-icons.sh). The `icon` entries are the browser tab;
  // the SVG is listed first so a browser that takes it gets the crisp one.
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-touch-icon.png",
  },
  // What makes an iOS home-screen launch run as an app rather than a Safari tab.
  // `title` here is the *home screen label* — it renders as
  // <meta name="apple-mobile-web-app-title">, a different tag from <title>, so it
  // does not touch the client-owned document title the comment above protects.
  //
  // `black-translucent` runs the layout under the status bar rather than below it,
  // which is not a cosmetic choice: globals.css already offsets .nav by
  // env(safe-area-inset-top) for exactly this, so `black` would double the gap.
  //
  // `capable: true` renders as <meta name="mobile-web-app-capable">, NOT the
  // apple-prefixed tag you may be looking for — Next 16 emits the standardized
  // name. Nothing is lost: iOS has taken standalone mode from the manifest's own
  // `display` since 15.4, and WebKit recognizes the unprefixed name too.
  appleWebApp: {
    capable: true,
    title: "Mojito",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Ask supporting browsers (Chromium) to shrink the layout viewport when the
  // virtual keyboard opens so `100dvh` reflects the space above it. iOS Safari
  // ignores this; the visualViewport handler in TerminalView is the actual fix.
  interactiveWidget: "resizes-content",
  // Paints the browser/OS chrome around the app — the Android address bar, the
  // task switcher card. Kept equal to --bg and to the manifest's own two colours
  // (tests/client/manifest.test.ts pins those) so nothing flashes a different dark
  // before the CSS lands. Lives on `viewport`, not `metadata`: Next deprecated
  // `metadata.themeColor`.
  themeColor: "#0d0f11",
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
