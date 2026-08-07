import { WORK_PROMPT_TEMPLATE } from "./prompts/work.js";
import { CONFLICT_PROMPT_TEMPLATE } from "./prompts/conflict.js";

export interface PromptVars {
  ticket: string;
  contextPath: string;
  resultPath: string;
}

function render(template: string, vars: PromptVars): string {
  for (const [k, v] of Object.entries(vars)) {
    if (v.includes("{{")) throw new Error(`prompt var ${k} must not contain '{{'`);
  }
  return template
    .replaceAll("{{TICKET}}", vars.ticket)
    .replaceAll("{{CONTEXT_PATH}}", vars.contextPath)
    .replaceAll("{{RESULT_PATH}}", vars.resultPath);
}

export const buildWorkPrompt = (vars: PromptVars): string => render(WORK_PROMPT_TEMPLATE, vars);
export const buildConflictPrompt = (vars: PromptVars): string => render(CONFLICT_PROMPT_TEMPLATE, vars);
