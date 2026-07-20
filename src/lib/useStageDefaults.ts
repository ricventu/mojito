"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import type { StageDefaults } from "./stageDefaults";

export function useStageDefaults(token: string) {
  const [defaults, setDefaults] = useState<StageDefaults>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch(token, "/api/config/stage-defaults");
      if (!res.ok) throw new Error(String(res.status));
      setDefaults(await res.json());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  const save = useCallback(async (next: StageDefaults): Promise<boolean> => {
    const res = await apiFetch(token, "/api/config/stage-defaults", {
      method: "PUT",
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      let message = `save failed (${res.status})`;
      try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* non-JSON */ }
      setError(message);
      return false;
    }
    setDefaults(await res.json());
    setError(null);
    return true;
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);
  return { defaults, loading, error, save };
}
