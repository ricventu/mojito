"use client";
import { useCallback, useEffect, useState } from "react";
import { resolveInitialToken } from "./resolveInitialToken";

export function useToken() {
  const [token, setTokenState] = useState<string>("");
  useEffect(() => {
    const { token: initial, fromUrl } = resolveInitialToken(
      window.location.search,
      localStorage.getItem("mojito-token"),
    );
    if (fromUrl) {
      // Auto-login from the URL token, then strip it from the address bar so it
      // isn't left in history/shared screenshots.
      localStorage.setItem("mojito-token", initial);
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
    setTokenState(initial);
  }, []);
  // Any API call that gets a 401 means the stored token is no longer valid —
  // clear it so the login gate reappears. Without this, a bad token in
  // localStorage leaves the app stuck: the gate only shows for an empty token,
  // and every request fails silently (RIC-314).
  useEffect(() => {
    const onUnauthorized = () => {
      localStorage.removeItem("mojito-token");
      setTokenState("");
    };
    window.addEventListener("mojito-unauthorized", onUnauthorized);
    return () => window.removeEventListener("mojito-unauthorized", onUnauthorized);
  }, []);
  const setToken = useCallback((t: string) => {
    localStorage.setItem("mojito-token", t);
    setTokenState(t);
  }, []);
  return { token, setToken };
}
