"use client";
import { useEffect, useState } from "react";
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
  const setToken = (t: string) => {
    localStorage.setItem("mojito-token", t);
    setTokenState(t);
  };
  return { token, setToken };
}
