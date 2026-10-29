import { describe, expect, it } from "vitest";
import { BOARD_SEARCH_KEY, boardHref, rememberBoardSearch } from "@/lib/boardReturn";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

const throwing: Storage = {
  length: 0,
  clear: () => {},
  key: () => null,
  getItem: () => {
    throw new Error("denied");
  },
  removeItem: () => {},
  setItem: () => {
    throw new Error("denied");
  },
};

describe("boardReturn", () => {
  it('is "/" when nothing is remembered', () => {
    expect(boardHref(fakeStorage())).toBe("/");
  });

  it('remembers a search and returns "/?<search>"', () => {
    const store = fakeStorage();
    rememberBoardSearch("project=mojito&status=Todo", store);
    expect(store.getItem(BOARD_SEARCH_KEY)).toBe("project=mojito&status=Todo");
    expect(boardHref(store)).toBe("/?project=mojito&status=Todo");
  });

  it('remembers "" as "/"', () => {
    const store = fakeStorage();
    rememberBoardSearch("q=x", store);
    rememberBoardSearch("", store);
    expect(boardHref(store)).toBe("/");
  });

  it('a store that throws gives "/" and does not throw', () => {
    expect(() => rememberBoardSearch("q=x", throwing)).not.toThrow();
    expect(boardHref(throwing)).toBe("/");
  });

  it('a null store gives "/" and does not throw', () => {
    expect(() => rememberBoardSearch("q=x", null)).not.toThrow();
    expect(boardHref(null)).toBe("/");
  });
});
