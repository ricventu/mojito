"use client";
import { useEffect, useState } from "react";

export function useToken() {
  const [token, setTokenState] = useState<string>("");
  useEffect(() => {
    setTokenState(localStorage.getItem("mojito-token") ?? "");
  }, []);
  const setToken = (t: string) => {
    localStorage.setItem("mojito-token", t);
    setTokenState(t);
  };
  return { token, setToken };
}
