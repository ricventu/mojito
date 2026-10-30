import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "@/components/AppShell";
import { Board } from "@/components/board/Board";
import { RouteError } from "@/components/RouteError";
import { chunkLoaded, sessionStore } from "@/lib/chunkReload";

export const router = createBrowserRouter([
  {
    // Pathless: one error boundary for every page, the lazy terminal's failed import included.
    errorElement: <RouteError />,
    // Pathless too: the frame every page sits in (the session sidebar, drawn once).
    children: [
      {
        element: <AppShell />,
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
          // Lazy too: Settings is the only page that validates with zod (the shared request schemas).
          {
            path: "/settings",
            lazy: () =>
              import("@/components/settings/SettingsPage").then((m) => {
                chunkLoaded(sessionStore());
                return { Component: m.SettingsPage };
              }),
          },
          // Lazy: only the git page needs the graph layout and its rows.
          {
            path: "/git/:project",
            lazy: () =>
              import("@/components/git/GitGraphPage").then((m) => {
                chunkLoaded(sessionStore());
                return { Component: m.GitGraphPage };
              }),
          },
          // Lazy: only the docs page needs the markdown parser.
          {
            path: "/docs/:project",
            lazy: () =>
              import("@/components/docs/DocsPage").then((m) => {
                chunkLoaded(sessionStore());
                return { Component: m.DocsPage };
              }),
          },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
