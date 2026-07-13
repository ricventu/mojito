import "./globals.css";
import type { ReactNode } from "react";
import SwRegister from "@/components/SwRegister";

export const metadata = { title: "Mojito", manifest: "/manifest.webmanifest" };
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" as const };

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
