import { createBrowserRouter, Navigate } from "react-router";
import { Board } from "@/components/board/Board";
import { RouteError } from "@/components/RouteError";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { chunkLoaded, sessionStore } from "@/lib/chunkReload";

export const router = createBrowserRouter([
  {
    // Pathless: one error boundary for every page, the lazy terminal's failed import included.
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <Board /> },
      // Lazy: xterm is most of the bundle, and the board never needs it.
      {
        path: "/session/:id",
        lazy: () =>
          import("@/components/terminal/TerminalPage").then((m) => {
            chunkLoaded(sessionStore());
            return { Component: m.TerminalPage };
          }),
      },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
