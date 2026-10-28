import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getToken, setToken, subscribeToken } from "@/lib/token";

/** Shows its children only while there is a token; a 401 anywhere clears it and lands back here. */
export function TokenGate({ children }: { children: ReactNode }) {
  const token = useSyncExternalStore(subscribeToken, getToken);
  const [draft, setDraft] = useState("");

  if (token) return <>{children}</>;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = draft.trim();
    if (value) setToken(value);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 pt-[var(--sat)] pb-[var(--sab)]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound size={18} /> Mojito
          </CardTitle>
          <CardDescription>Inserisci il token di accesso per continuare.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="token">Token</Label>
              <Input
                id="token"
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!draft.trim()}>Entra</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
