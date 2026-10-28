import { createBrowserRouter, Link, Navigate } from "react-router";
import { Board } from "@/components/board/Board";

// Placeholder pages: the terminal and the settings arrive in later tasks.
function Session() {
  return <main className="p-4 pt-[calc(var(--sat)+1rem)]">Sessione</main>;
}

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
  { path: "/session/:id", element: <Session /> },
  { path: "/settings", element: <Settings /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);
