import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Mojito" };
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" as const };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
