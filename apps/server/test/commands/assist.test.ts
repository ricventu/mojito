import { ASSIST_PROMPT, COMMAND_ICONS, COMMAND_PROMPT_MAX } from "@mojito/shared";
import { describe, expect, it, vi } from "vitest";
import { AssistError, assistCommand } from "../../src/commands/assist";
import type { QueryFn } from "../../src/tasks/runner";

/** A fake `query` whose stream is one `result` message. */
function fakeQuery(result: Record<string, unknown>) {
  const fn = vi.fn((_args: unknown) =>
    (async function* () {
      yield { type: "result", ...result };
    })(),
  );
  return fn as unknown as QueryFn & typeof fn;
}
const ok = (text: string) => fakeQuery({ subtype: "success", result: text });

describe("assistCommand", () => {
  it("answers the model's JSON", async () => {
    const json = JSON.stringify({ name: "Deps", prompt: "Update the dependencies.", icon: "package" });
    expect(await assistCommand({ text: "update deps" }, { query: ok(json) })).toEqual({
      name: "Deps",
      prompt: "Update the dependencies.",
      icon: "package",
    });
  });

  it("reads JSON inside a code fence", async () => {
    const text = '```json\n{"name":"Deps","prompt":"Update.","icon":"bug"}\n```';
    expect((await assistCommand({ text: "x" }, { query: ok(text) })).icon).toBe("bug");
  });

  it("falls back to the form's icon, else zap, for an unknown one", async () => {
    const text = '{"name":"A","prompt":"p","icon":"skull"}';
    expect((await assistCommand({ text: "x", icon: "rocket" }, { query: ok(text) })).icon).toBe("rocket");
    expect((await assistCommand({ text: "x" }, { query: ok(text) })).icon).toBe("zap");
  });

  it("refuses a prompt over COMMAND_PROMPT_MAX: tmux could never run it", async () => {
    const at = JSON.stringify({ name: "A", prompt: "x".repeat(COMMAND_PROMPT_MAX), icon: "zap" });
    expect((await assistCommand({ text: "x" }, { query: ok(at) })).prompt).toHaveLength(COMMAND_PROMPT_MAX);
    const over = JSON.stringify({ name: "A", prompt: "x".repeat(COMMAND_PROMPT_MAX + 1), icon: "zap" });
    await expect(assistCommand({ text: "x" }, { query: ok(over) })).rejects.toThrow(new AssistError("the answer was too long"));
  });

  it("tells the model the prompt's cap", () => expect(ASSIST_PROMPT).toContain(`${COMMAND_PROMPT_MAX} characters`));

  it("trims the name and cuts it to 40", async () => {
    const text = JSON.stringify({ name: `  ${"n".repeat(50)}  `, prompt: "p", icon: "zap" });
    expect((await assistCommand({ text: "x" }, { query: ok(text) })).name).toBe("n".repeat(40));
  });

  it("refuses an answer that is not JSON", async () => {
    await expect(assistCommand({ text: "x" }, { query: ok("Sure! Here you go.") })).rejects.toBeInstanceOf(AssistError);
  });

  it("refuses JSON without a prompt", async () => {
    await expect(assistCommand({ text: "x" }, { query: ok('{"name":"A","prompt":"","icon":"zap"}') })).rejects.toBeInstanceOf(AssistError);
  });

  it("refuses a result that is not a success", async () => {
    const q = fakeQuery({ subtype: "error_max_turns", errors: [] });
    await expect(assistCommand({ text: "x" }, { query: q })).rejects.toBeInstanceOf(AssistError);
  });

  it("gives up after the timeout", async () => {
    const hang = vi.fn(() =>
      (async function* () {
        await new Promise(() => {});
      })(),
    ) as unknown as QueryFn;
    await expect(assistCommand({ text: "x" }, { query: hang, timeoutMs: 10 })).rejects.toThrow(/timed out/);
  });

  it("calls the SDK with no tools, no settings and the project and icons in the message", async () => {
    const q = ok('{"name":"A","prompt":"p","icon":"zap"}');
    await assistCommand({ text: "rough idea", project: "Web" }, { query: q });
    const args = q.mock.calls[0]![0] as { prompt: AsyncIterable<unknown>; options: Record<string, unknown> };
    expect(args.options).toMatchObject({ settingSources: [], tools: [], model: "sonnet", maxTurns: 1, systemPrompt: ASSIST_PROMPT });
    expect(args.options.abortController).toBeInstanceOf(AbortController);
    const sent: string[] = [];
    for await (const m of args.prompt) sent.push(JSON.stringify(m));
    const joined = sent.join("");
    expect(joined).toContain("Web");
    expect(joined).toContain("rough idea");
    for (const icon of COMMAND_ICONS) expect(joined).toContain(icon);
  });
});
