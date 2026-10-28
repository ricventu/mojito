import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { TokenGate } from "@/components/TokenGate";
import { Toaster } from "@/components/ui/sonner";
import { useEvents } from "@/hooks/useEvents";
import { ApiError } from "@/lib/api";
import { router } from "@/routes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx will not heal by asking again (and a 401 has already sent the gate back).
      retry: (count, error) => !(error instanceof ApiError) && count < 2,
    },
  },
});

function Live() {
  useEvents();
  return <RouterProvider router={router} />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TokenGate>
        <Live />
      </TokenGate>
      <Toaster />
    </QueryClientProvider>
  );
}
