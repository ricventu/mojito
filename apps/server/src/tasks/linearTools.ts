import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { LinearClient } from "../linear/client";
import { errorMessage } from "../http/body";

export const LINEAR_MCP_NAME = "mojito-linear";

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError } : {}) });

/**
 * The only door the create-ticket agent has to Linear: an in-process MCP server over Mojito's
 * own client, so the API key never leaves the server. One per task — `onCreated` is how the
 * task learns its outcome, and a second `create_issue` is refused so a model that retries after
 * a success cannot file the ticket twice.
 */
export function createLinearMcp(
  linear: Pick<LinearClient, "listLabels" | "createIssue">,
  onCreated: (r: { identifier: string; url: string }) => void,
): McpSdkServerConfigWithInstance {
  let created: { identifier: string; url: string } | null = null;
  return createSdkMcpServer({
    name: LINEAR_MCP_NAME,
    version: "1.0.0",
    tools: [
      tool("list_labels", "Le label utilizzabili sul team Linear indicato, con il loro id.", { team: z.string().describe("Chiave del team, es. RIC") }, async ({ team }) => {
        try {
          return text(JSON.stringify(await linear.listLabels(team)));
        } catch (err) {
          return text(errorMessage(err), true);
        }
      }),
      tool(
        "create_issue",
        "Crea il ticket Linear. Da chiamare una sola volta.",
        {
          team: z.string().describe("Chiave del team, es. RIC"),
          project: z.string().describe("Nome del progetto Linear"),
          title: z.string(),
          description: z.string().describe("Markdown"),
          labelId: z.string().optional().describe("Id di una label restituita da list_labels"),
        },
        async ({ team, project, title, description, labelId }) => {
          if (created) return text(`ticket già creato: ${created.identifier} ${created.url}`, true);
          try {
            const r = await linear.createIssue({ teamKey: team, project, title, description, ...(labelId ? { labelId } : {}) });
            created = r;
            onCreated(r);
            return text(`Creato ${r.identifier}: ${r.url}`);
          } catch (err) {
            return text(errorMessage(err), true);
          }
        },
      ),
    ],
  });
}
