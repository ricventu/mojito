import { ASSIST_PROMPT, COMMAND_ICONS, type AssistAnswer, type AssistBody, type CommandIcon } from "@mojito/shared";
import { z } from "zod";
import { agentEnv, type QueryFn } from "../tasks/runner";

/** The assistant's answer could not be had or read; the message goes to the 502. */
export class AssistError extends Error {}

export interface AssistDeps {
  query: QueryFn;
  /** Default 60 000. */
  timeoutMs?: number;
}

const Proposal = z.object({ name: z.string(), prompt: z.string().trim().min(1).max(20000), icon: z.string() });

const message = ({ text, project }: AssistBody): string =>
  [
    project ? `Project: ${project}` : "Project: none given",
    `Icons to choose from: ${COMMAND_ICONS.join(", ")}`,
    "Text to turn into a command:",
    text,
  ].join("\n");

/** The first JSON object in the answer, fenced or not. */
function parseAnswer(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new AssistError("the assistant did not answer with JSON");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AssistError("the assistant did not answer with JSON");
  }
}

/**
 * One tool-less Agent SDK call (as the create-ticket task runs it) that turns rough text into a
 * command's name, prompt and icon. Stateless: nothing is stored.
 */
export async function assistCommand(body: AssistBody, deps: AssistDeps): Promise<AssistAnswer> {
  const timeoutMs = deps.timeoutMs ?? 60_000;
  const abortController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abortController.abort();
      reject(new AssistError(`the assistant timed out after ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
  });
  const content = message(body);
  const run = async (): Promise<string> => {
    const stream = deps.query({
      prompt: (async function* () {
        yield { type: "user" as const, message: { role: "user" as const, content }, parent_tool_use_id: null, session_id: "" };
      })(),
      options: {
        model: "sonnet",
        systemPrompt: ASSIST_PROMPT,
        settingSources: [],
        tools: [],
        maxTurns: 1,
        env: agentEnv(),
        abortController,
      },
    });
    for await (const m of stream) {
      if (m.type !== "result") continue;
      if (m.subtype !== "success") throw new AssistError(`the assistant failed: ${m.subtype}`);
      return m.result;
    }
    throw new AssistError("the assistant gave no answer");
  };
  try {
    const answer = await Promise.race([run(), timedOut]);
    const parsed = Proposal.safeParse(parseAnswer(answer));
    if (!parsed.success) throw new AssistError("the assistant's answer had no name or prompt");
    const name = parsed.data.name.trim().slice(0, 40).trim();
    if (!name) throw new AssistError("the assistant's answer had no name or prompt");
    const icon = (COMMAND_ICONS as readonly string[]).includes(parsed.data.icon) ? (parsed.data.icon as CommandIcon) : (body.icon ?? "zap");
    return { name, prompt: parsed.data.prompt, icon };
  } catch (err) {
    if (err instanceof AssistError) throw err;
    throw new AssistError(`the assistant failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
