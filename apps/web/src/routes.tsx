import { createBrowserRouter, Link, Navigate } from "react-router";
import { useSessions } from "@/hooks/useSessions";
import { useTickets } from "@/hooks/useTickets";

// Placeholder pages: the board, the terminal and the settings arrive in later tasks.
function Board() {
  const tickets = useTickets();
  const sessions = useSessions();
  return (
    <main className="p-4 pt-[calc(var(--sat)+1rem)]">
      <h1 className="text-lg font-semibold">Board</h1>
      <p className="text-sm text-muted-foreground">
        {tickets.data?.tickets.length ?? 0} ticket · {sessions.data?.length ?? 0} sessioni
      </p>
      <Link className="text-sm underline" to="/settings">Impostazioni</Link>
    </main>
  );
}

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
