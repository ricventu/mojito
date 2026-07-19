# Terminal Mobile Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a mobile user paste text into the running session's terminal via a reveal-on-demand paste field in the accessory bar.

**Architecture:** Add a `📋` button to `AccessoryBar` that reveals a real `<textarea>`; the user pastes natively (works over HTTP), reviews/edits, then taps **Inietta**, which routes the text through `xterm`'s own `paste()` so bracketed-paste is applied exactly like a desktop paste. The text lands in Claude's editable prompt line — not submitted.

**Tech Stack:** TypeScript, React (Next.js "use client" components), xterm.js (`@xterm/xterm` ^5.5.0), vitest.

## Global Constraints

- All code artifacts (identifiers, comments, strings) in **English**; user-facing copy may be Italian (matches the chosen labels "Inietta", the placeholder).
- Path alias: `@/*` → `src/*` (both `tsconfig.json` and `vitest.config.ts`).
- Vitest: `environment: "node"`, test files matched by `tests/**/*.test.ts`. No DOM/React-Testing-Library infra exists — do **not** add it. Component behavior is verified by typecheck + manual iOS check.
- Full check command: `npx tsc --noEmit && npx vitest run`.
- Inject text through `termRef.current?.paste(text)` — never a raw WebSocket send — so bracketed-paste wrapping matches desktop.

---

### Task 1: `normalizePaste` pure helper

**Files:**
- Create: `src/lib/pasteText.ts`
- Test: `tests/lib/pasteText.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizePaste(value: string): string | null` — returns `value` **verbatim** when it contains at least one non-whitespace character, otherwise `null`. Does NOT trim the returned value (internal and surrounding content is preserved; only the emptiness *decision* uses a trimmed check).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/pasteText.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizePaste } from "@/lib/pasteText";

describe("normalizePaste", () => {
  it("returns the value verbatim when it has non-whitespace content", () => {
    expect(normalizePaste("hello")).toBe("hello");
  });

  it("preserves surrounding whitespace in a non-empty value", () => {
    expect(normalizePaste("  hi  ")).toBe("  hi  ");
  });

  it("preserves internal newlines of a multi-line paste", () => {
    expect(normalizePaste("line one\nline two")).toBe("line one\nline two");
  });

  it("returns null for an empty string", () => {
    expect(normalizePaste("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(normalizePaste("   \n\t ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/pasteText.test.ts`
Expected: FAIL — cannot resolve `@/lib/pasteText` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/pasteText.ts`:

```ts
// Decide whether a pasted textarea value is worth injecting into the terminal.
// Returns the value verbatim (whitespace preserved) when it holds any
// non-whitespace character, else null. The emptiness check trims, but the
// returned value never is — a multi-line snippet must reach the pty unchanged.
export function normalizePaste(value: string): string | null {
  return value.trim().length > 0 ? value : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/pasteText.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pasteText.ts tests/lib/pasteText.test.ts
git commit -m "feat(mojito): add normalizePaste helper for terminal paste"
```

---

### Task 2: Paste affordance in AccessoryBar, wired into TerminalView

**Files:**
- Modify: `src/components/AccessoryBar.tsx` (full rewrite of the component)
- Modify: `src/components/TerminalView.tsx:276` (pass the new prop)
- Modify: `src/app/globals.css` (add paste-field styles after the `.acc` block at line 255-258)

**Interfaces:**
- Consumes: `normalizePaste` from `@/lib/pasteText` (Task 1); `Terminal.paste(data: string): void` from xterm; the existing `termRef` (`useRef<Terminal | null>`) in `TerminalView`.
- Produces: `AccessoryBar` gains a required prop `onPasteText: (text: string) => void` alongside the existing `onSend: (bytes: string) => void`.

- [ ] **Step 1: Rewrite `AccessoryBar.tsx`**

Replace the entire contents of `src/components/AccessoryBar.tsx` with:

```tsx
"use client";
import { useState } from "react";
import { normalizePaste } from "@/lib/pasteText";

const KEYS: { label: string; bytes: string }[] = [
  { label: "Esc", bytes: "\x1b" },
  { label: "Tab", bytes: "\t" },
  { label: "↑", bytes: "\x1b[A" },
  { label: "↓", bytes: "\x1b[B" },
  { label: "←", bytes: "\x1b[D" },
  { label: "→", bytes: "\x1b[C" },
  { label: "⏎", bytes: "\r" },
  { label: "⇧⏎", bytes: "\n" },
  { label: "^C", bytes: "\x03" },
  { label: "1", bytes: "1" },
  { label: "2", bytes: "2" },
  { label: "3", bytes: "3" },
];

export default function AccessoryBar(
  { onSend, onPasteText }:
  { onSend: (bytes: string) => void; onPasteText: (text: string) => void },
) {
  // Mobile paste: the terminal itself is a non-editable xterm canvas, so iOS
  // offers no "Incolla" on long-press. This reveals a real <textarea> the user
  // can paste into natively (works over plain HTTP, unlike navigator.clipboard),
  // review/edit, then inject into the terminal via xterm's own paste path.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const inject = () => {
    const text = normalizePaste(draft);
    if (text) onPasteText(text);
    setDraft("");
    setPasteOpen(false);
  };

  const cancel = () => {
    setDraft("");
    setPasteOpen(false);
  };

  return (
    <div className="acc-wrap">
      {pasteOpen && (
        <div className="paste-field">
          {/* autoFocus fires on mount (when pasteOpen flips true), so the field
              is ready for an immediate long-press → Incolla. */}
          <textarea
            autoFocus
            className="paste-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Long-press → Incolla, poi Inietta"
          />
          <button type="button" className="k" onClick={inject}>Inietta</button>
          <button type="button" className="k" aria-label="Cancel paste" onClick={cancel}>×</button>
        </div>
      )}
      <div className="acc">
        {KEYS.map((k) => (
          <button key={k.label} className="k" onClick={() => onSend(k.bytes)}>{k.label}</button>
        ))}
        <button type="button" className="k" aria-label="Paste" onClick={() => setPasteOpen((v) => !v)}>📋</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the prop in `TerminalView.tsx`**

At `src/components/TerminalView.tsx:276`, change:

```tsx
      <AccessoryBar onSend={send} />
```

to:

```tsx
      <AccessoryBar onSend={send} onPasteText={(t) => termRef.current?.paste(t)} />
```

(`termRef` is the existing `useRef<Terminal | null>` declared at line 22; `Terminal.paste` applies bracketed-paste when Claude's TUI enabled it, then fires the existing `onData` handler at line 115 → WebSocket → pty.)

- [ ] **Step 3: Add paste-field styles**

In `src/app/globals.css`, immediately after the `.acc` rules (currently lines 255-258), add:

```css
.acc-wrap { display: flex; flex-direction: column; }
.paste-field { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--border); background: var(--surface); }
.paste-field .paste-input {
  flex: 1; min-width: 0; height: 40px; resize: none;
  padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface-hi); color: var(--text);
  font: inherit;
}
```

- [ ] **Step 4: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass (including Task 1's `normalizePaste` tests). The `onPasteText` prop is now required, so a missing wire-up in `TerminalView` would surface here as a type error — confirm it does not.

- [ ] **Step 5: Manual verification on iOS Safari (required — not automatable here)**

Prerequisite: dev server running and reachable from the phone over the LAN IP
(`npm run dev`, then open `http://<LAN-IP>:<port>` on the iPhone — do NOT start a
second server in the main checkout if one is already live on the dev port).

Open a session's terminal, then:
1. Tap `📋` → the paste field appears, focused, keyboard up.
2. Copy some multi-line text elsewhere, long-press the field → **Incolla** → text
   appears in the field and is editable.
3. Tap **Inietta** → text lands in Claude's prompt line (newlines preserved, NOT
   auto-submitted); the field clears and closes.
4. Reopen `📋`, tap `×` → field closes with nothing injected.
5. On desktop, confirm the `📋` button is present and harmless, and native ctrl+v
   into the terminal still works.

- [ ] **Step 6: Commit**

```bash
git add src/components/AccessoryBar.tsx src/components/TerminalView.tsx src/app/globals.css
git commit -m "feat(mojito): paste text into the terminal from mobile"
```

---

## Self-Review

**Spec coverage:**
- Reveal-on-demand `📋` + textarea + Inietta + × → Task 2, Step 1. ✓
- `<textarea>` not `<input>` (preserve newlines) → Task 2, Step 1 (textarea used); Task 1 test asserts newline preservation. ✓
- Review-then-inject (no auto-inject on paste) → Task 2: injection only on **Inietta** tap. ✓
- Route via `term.paste()` for bracketed-paste → Task 2, Step 2. ✓
- `📋` always visible (no touch detection) → Task 2, Step 1 (rendered unconditionally). ✓
- Error handling: empty/whitespace → `normalizePaste` null → no-op (Task 1); `termRef.current` null → optional-chaining no-op (Task 2, Step 2). ✓
- Testing: unit test for `normalizePaste` (Task 1); manual iOS (Task 2, Step 5). ✓
- Out of scope (new-ticket image paste, HTTPS) → not touched. ✓

**Placeholder scan:** none.

**Type consistency:** `normalizePaste(value: string): string | null` used identically in Task 1 and Task 2. Prop name `onPasteText` consistent between `AccessoryBar` definition and `TerminalView` call site. `termRef` matches the existing declaration.
