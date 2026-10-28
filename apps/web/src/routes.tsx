import { createBrowserRouter, Link, Navigate } from "react-router";
import { Board } from "@/components/board/Board";

// Placeholder page: the settings arrive in a later task.
function Settings() {
  return (
    <main className="p-4 pt-[calc(var(--sat)+1rem)]">
      <h1 className="text-lg font-semibold">Impostazioni</h1>
      <Link className="text-sm underline" to="/">Board</Link>
    </main>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: <Board /> },
  // Lazy: xterm is most of the bundle, and the board never needs it.
  {
    path: "/session/:id",
    lazy: () => import("@/components/terminal/TerminalPage").then((m) => ({ Component: m.TerminalPage })),
  },
  { path: "/settings", element: <Settings /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);
