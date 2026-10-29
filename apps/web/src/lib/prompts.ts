import { PromptsBody, type PromptKey, type Prompts } from "@mojito/shared";

/** The server's own validation, as one message per prompt that fails it. */
export function promptErrors(prompts: Prompts): Partial<Record<PromptKey, string>> {
  const parsed = PromptsBody.safeParse(prompts);
  if (parsed.success) return {};
  const out: Partial<Record<PromptKey, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as PromptKey;
    out[key] ??= issue.message;
  }
  return out;
}
