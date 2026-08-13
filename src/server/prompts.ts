import { WORK_PROMPT_TEMPLATE, ASSETS_PARAGRAPH } from "./prompts/work.js";
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

export interface WorkPromptVars extends PromptVars {
  // Whether the launch context actually carries assets/attachments. False drops the whole
  // paragraph describing them rather than telling the session about keys it will not find.
  hasAssets: boolean;
}

export function buildWorkPrompt(vars: WorkPromptVars): string {
  const { hasAssets, ...base } = vars;
  return render(WORK_PROMPT_TEMPLATE, base)
    .replaceAll("{{ASSETS_PARAGRAPH}}", hasAssets ? ASSETS_PARAGRAPH : "");
}

export function buildMergeFixPrompt(vars: MergeFixPromptVars): string {
  const { mergeMode, blocker, ...base } = vars;
  const safeBlocker = blocker.replaceAll("{{", "{ {").trim() || "(no diagnostic output)";
  return render(MERGE_FIX_PROMPT_TEMPLATE, base)
    .replaceAll("{{COMPLETE_STEP}}", mergeMode === "local" ? COMPLETE_STEP_LOCAL : COMPLETE_STEP_MR)
    .replaceAll("{{BLOCKER}}", safeBlocker);
}
