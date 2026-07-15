"use client";
import { useState } from "react";

// Pure, testable: returns the stored string, or the fallback when the key is
// absent or storage is unavailable (SSR / no window).
export function readPersisted(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string,
  fallback: string,
): string {
  return storage?.getItem(key) ?? fallback;
}

// Drop-in useState replacement that mirrors a string value into localStorage.
// String-valued only (callers store a tab id, a search string, or a project
// sentinel), so no JSON serialization is needed.
export function usePersistedState(
  key: string,
  initial: string,
): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() =>
    readPersisted(typeof window === "undefined" ? undefined : window.localStorage, key, initial),
  );
  const set = (v: string) => {
    setValue(v);
    if (typeof window !== "undefined") window.localStorage.setItem(key, v);
  };
  return [value, set];
}
