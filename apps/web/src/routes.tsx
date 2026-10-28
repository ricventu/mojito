import { createBrowserRouter, Navigate } from "react-router";
import { Board } from "@/components/board/Board";
import { SettingsPage } from "@/components/settings/SettingsPage";

export const router = createBrowserRouter([
  { path: "/", element: <Board /> },
  // Lazy: xterm is most of the bundle, and the board never needs it.
  {
    path: "/session/:id",
    lazy: () => import("@/components/terminal/TerminalPage").then((m) => ({ Component: m.TerminalPage })),
  },
  { path: "/settings", element: <SettingsPage /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);
