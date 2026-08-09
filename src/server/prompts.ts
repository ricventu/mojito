import { WORK_PROMPT_TEMPLATE } from "./prompts/work.js";
import { MERGE_FIX_PROMPT_TEMPLATE, COMPLETE_STEP_LOCAL, COMPLETE_STEP_MR } from "./prompts/conflict.js";
import type { MergeMode } from "./merge.js";

export interface PromptVars {
  ticket: string;
  contextPath: string;
  resultPath: string;
}

export interface MergeFixPromptVars extends PromptVars {
  mergeMode: MergeMode;
  // The failed merge attempt's diagnostic (git output). Free text: sanitized, not rejected,
  // since it is machine-produced and must never be able to fail the launch.
  blocker: string;
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

export function buildMergeFixPrompt(vars: MergeFixPromptVars): string {
  const { mergeMode, blocker, ...base } = vars;
  const safeBlocker = blocker.replaceAll("{{", "{ {").trim() || "(no diagnostic output)";
  return render(MERGE_FIX_PROMPT_TEMPLATE, base)
    .replaceAll("{{COMPLETE_STEP}}", mergeMode === "local" ? COMPLETE_STEP_LOCAL : COMPLETE_STEP_MR)
    .replaceAll("{{BLOCKER}}", safeBlocker);
}
