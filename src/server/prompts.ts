import { WORK_PROMPT_TEMPLATE, ASSETS_PARAGRAPH } from "./prompts/work";
import { MERGE_FIX_PROMPT_TEMPLATE, COMPLETE_STEP_LOCAL, COMPLETE_STEP_MR } from "./prompts/conflict";
import { INTAKE_PROMPT_TEMPLATE, INTAKE_IMAGES_PARAGRAPH } from "./prompts/intake";
import type { MergeMode } from "./merge";

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

export interface IntakePromptVars {
  draftPath: string;
  teamKey: string;
  // null = the "General" choice in the sheet: a team, but no Linear project.
  projectName: string | null;
  // Whether the draft carries any image url. False drops the whole images paragraph
  // rather than pointing the session at an empty array (RIC-223).
  hasImages: boolean;
}

// Neutralized rather than rejected, unlike the work prompt's vars: the team key and the
// project name come out of projects.json, and a typo in a config file must not be able to
// fail a ticket the human has already written.
const defuse = (s: string) => s.replaceAll("{{", "{ {");

export function buildIntakePrompt(vars: IntakePromptVars): string {
  const clause = vars.projectName
    ? `in project "${defuse(vars.projectName)}"`
    : "with no project (the sheet's \"General\" choice)";
  return INTAKE_PROMPT_TEMPLATE
    .replaceAll("{{DRAFT_PATH}}", defuse(vars.draftPath))
    .replaceAll("{{TEAM_KEY}}", defuse(vars.teamKey))
    .replaceAll("{{PROJECT_CLAUSE}}", clause)
    .replaceAll("{{IMAGES_PARAGRAPH}}", vars.hasImages ? INTAKE_IMAGES_PARAGRAPH : "");
}
