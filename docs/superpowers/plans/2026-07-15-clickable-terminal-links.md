# Clickable Terminal Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `http(s)://` URLs printed in the Mojito terminal view clickable/tappable, opening them in a new browser tab.

**Architecture:** Load xterm.js's official `@xterm/addon-web-links` (`WebLinksAddon`) alongside the existing `FitAddon` in `src/components/TerminalView.tsx`. The addon detects URLs in rendered output and calls an activation handler on click/tap; the handler opens the URL in a new tab. Single-component change plus one dependency.

**Tech Stack:** Next.js, TypeScript, React, xterm.js (`@xterm/xterm@^5.5.0`, `@xterm/addon-fit`), `@xterm/addon-web-links`.

## Global Constraints

- All code artifacts (identifiers, comments, commit messages) in English.
- New dependency: `@xterm/addon-web-links` at `^0.11.0` (compatible with `@xterm/xterm@^5.5.0`).
- Links open in a new tab with `window.open(uri, "_blank", "noopener,noreferrer")`.
- Scope is `http(s)://` URLs only (addon default matcher). No OSC-8 support.
- Change is confined to `src/components/TerminalView.tsx` and `package.json`/lockfile.
- No automated behavioral test is added (xterm/DOM wiring, no extractable logic); the regression guard is `npx tsc --noEmit && npx vitest run` staying green, plus manual verification. This is intentional per the spec.

---

### Task 1: Add the web-links addon and wire it into the terminal

**Files:**
- Modify: `package.json` (add `@xterm/addon-web-links` to `dependencies`)
- Modify: `src/components/TerminalView.tsx` (import + load the addon in the setup `useEffect`)
- Modify: `package-lock.json` (updated by `npm install`)

**Interfaces:**
- Consumes: existing `Terminal` instance `term` and `FitAddon` instance `fit` created in the setup `useEffect` of `TerminalView.tsx` (around lines 22-32).
- Produces: no exported symbols; a behavioral change to the rendered terminal (URLs become clickable).

- [ ] **Step 1: Install the dependency**

Run:
```bash
npm install @xterm/addon-web-links@^0.11.0
```
Expected: `package.json` gains `"@xterm/addon-web-links": "^0.11.0"` under `dependencies`, `package-lock.json` updates, and `node_modules/@xterm/addon-web-links` exists.

Verify:
```bash
grep addon-web-links package.json
ls node_modules/@xterm/addon-web-links >/dev/null && echo present
```
Expected: the grep prints the dependency line and `present` is echoed.

- [ ] **Step 2: Confirm the current baseline is green**

Run:
```bash
npx tsc --noEmit && npx vitest run
```
Expected: `TypeScript: No errors found` and all tests pass (the suite currently has 76 passing tests, 0 failures). This confirms a clean starting point before editing.

- [ ] **Step 3: Import `WebLinksAddon`**

In `src/components/TerminalView.tsx`, add the import directly below the existing `FitAddon` import (currently line 4):

```typescript
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
```

- [ ] **Step 4: Load the addon in the setup effect**

In the setup `useEffect`, immediately after the existing FitAddon wiring:

```typescript
    const fit = new FitAddon();
    term.loadAddon(fit);
```

add the web-links addon before `term.open(holder.current!)`:

```typescript
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Make http(s) URLs in terminal output clickable; open in a new tab.
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        window.open(uri, "_blank", "noopener,noreferrer");
      }),
    );
```

No cleanup change is needed: the effect's existing `term.dispose()` (in the returned cleanup) disposes loaded addons with the terminal.

- [ ] **Step 5: Type-check and run the existing suite**

Run:
```bash
npx tsc --noEmit && npx vitest run
```
Expected: `TypeScript: No errors found` and all tests still pass, 0 failures. This is the automated regression guard for the change.

- [ ] **Step 6: Manual behavioral verification**

Start the app and open a session whose terminal output contains an `http(s)://` URL (for example a lime-printed GitLab merge-request link, or run `echo https://gitlab.com/furnax/viessmann/viessman-partner-v2/-/merge_requests/13` inside the session shell).

Confirm:
1. The URL is underlined when hovered (desktop) or pressed (mobile).
2. Clicking / tapping the URL opens it in a new browser tab.
3. Typing and scrolling in the terminal still behave as before (the addon only activates on the link itself).

If any check fails, do not commit — debug the wiring (correct import path, addon loaded before `term.open`, handler firing) and re-verify.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/components/TerminalView.tsx
git commit -m "feat(mojito): make terminal URLs clickable (RIC-112)"
```

---

## Self-Review

**1. Spec coverage:**
- "Add `@xterm/addon-web-links` `^0.11.0`" → Task 1, Step 1. ✓
- "Load `WebLinksAddon` next to `FitAddon` in the setup effect" → Task 1, Steps 3-4. ✓
- "Open in new tab with `noopener,noreferrer`" → Task 1, Step 4 handler. ✓
- "`http(s)://` only, no OSC-8" → addon default matcher; no OSC-8 code added. ✓
- "No cleanup change needed (`term.dispose()`)" → Task 1, Step 4 note. ✓
- "Automated regression guard (`tsc + vitest` green) + manual tap test" → Steps 2, 5, 6. ✓
- Out of scope (non-terminal UI, OSC-8, custom styling) → not implemented. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"add appropriate…". All code steps show exact code and commands. ✓

**3. Type consistency:** `WebLinksAddon` is constructed with a `(event: MouseEvent, uri: string) => void` handler, matching the addon's public constructor signature. `term` and `fit` reference the existing instances by their in-file names. ✓
