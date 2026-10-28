import type { query } from "@anthropic-ai/claude-agent-sdk";
import type { TaskRecord } from "@mojito/shared";
import type { ProjectsRepo } from "../db/projects";
import type { TasksRepo } from "../db/tasks";
import { spawnEnv } from "../env/childEnv";
import type { EventBus } from "../events/bus";
import { errorMessage } from "../http/body";
import type { LinearClient } from "../linear/client";
import type { TicketCache } from "../tickets/cache";
import { CREATE_TICKET_SYSTEM, buildCreateTicketMessage } from "./createTicket";
import { LINEAR_MCP_NAME, createLinearMcp } from "./linearTools";

export type QueryFn = typeof query;

export interface TaskQueueDeps {
  tasks: TasksRepo;
  projects: Pick<ProjectsRepo, "get">;
  linear: Pick<LinearClient, "listLabels" | "createIssue">;
  bus: EventBus;
  tickets: Pick<TicketCache, "refresh">;
  query: QueryFn;
  fetchImage(url: string): Promise<{ mediaType: string; base64: string }>;
  concurrency?: number;
  now(): number;
}

const TOOL_PREFIX = `mcp__${LINEAR_MCP_NAME}__`;
export const RETRY_LOG_LINE = "— riprova —";

/**
 * Runs create-ticket tasks on the Agent SDK, at most `concurrency` at once, in enqueue order.
 * The queue itself lives in memory only: a task still waiting when the server stops is failed
 * at the next boot (`failInterrupted`) and retried from the UI.
 */
export class TaskQueue {
  private readonly waiting: string[] = [];
  private active = 0;
  private readonly concurrency: number;

  constructor(private readonly deps: TaskQueueDeps) {
    this.concurrency = deps.concurrency ?? 2;
  }

  enqueue(id: string): void {
    if (!this.waiting.includes(id)) this.waiting.push(id);
    this.pump();
  }

  /** Only a failed task: back to queued with the same input (images already on Linear). */
  retry(id: string): boolean {
    const t = this.deps.tasks.get(id);
    if (!t || t.status !== "failed") return false;
    this.write(id, { status: "queued", error: null, result: null, log: [...t.log, RETRY_LOG_LINE] });
    this.enqueue(id);
    return true;
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const id = this.waiting.shift()!;
      this.active++;
      void this.run(id).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private write(id: string, patch: Partial<TaskRecord>): void {
    const task = this.deps.tasks.update(id, { ...patch, updatedAt: this.deps.now() });
    if (task) this.deps.bus.emit({ type: "task.updated", task });
  }

  private appendLog(id: string, lines: string[]): void {
    const cur = this.deps.tasks.get(id);
    if (cur && lines.length > 0) this.write(id, { log: [...cur.log, ...lines] });
  }

  private async run(id: string): Promise<void> {
    const task = this.deps.tasks.get(id);
    if (!task || task.status !== "queued") return;
    this.write(id, { status: "running" });
    try {
      const outcome = await this.execute(task);
      if (outcome.created) {
        this.write(id, { status: "done", result: outcome.created, error: null });
        void this.deps.tickets.refresh();
      } else {
        this.write(id, { status: "failed", error: outcome.resultText || "nessun ticket creato" });
      }
    } catch (err) {
      this.write(id, { status: "failed", error: errorMessage(err) });
    }
  }

  private async execute(task: TaskRecord): Promise<{ created: { identifier: string; url: string } | null; resultText: string }> {
    const { project: name, note, imageUrls } = task.input;
    const project = this.deps.projects.get(name);
    if (!project) throw new Error(`progetto sconosciuto: ${name}`);
    const images = await Promise.all(imageUrls.map((u) => this.deps.fetchImage(u)));
    const message = buildCreateTicketMessage({ teamKey: project.teamKey, project: name, note, imageUrls }, images);

    let created: { identifier: string; url: string } | null = null;
    const mcp = createLinearMcp(this.deps.linear, (r) => {
      created = r;
    });
    let resultText = "";
    const stream = this.deps.query({
      prompt: (async function* () {
        yield message;
      })(),
      options: {
        model: "sonnet",
        systemPrompt: CREATE_TICKET_SYSTEM,
        settingSources: [],
        tools: [],
        mcpServers: { [LINEAR_MCP_NAME]: mcp },
        allowedTools: [`${TOOL_PREFIX}*`],
        maxTurns: 10,
        // Replaces the claude process's environment outright: Mojito's own credentials stay here.
        env: spawnEnv(),
      },
    });
    for await (const m of stream) {
      if (m.type === "assistant") {
        const lines: string[] = [];
        for (const block of m.message.content) {
          if (block.type === "text" && block.text.trim()) lines.push(block.text.trim());
          else if (block.type === "tool_use") lines.push(`→ ${block.name.startsWith(TOOL_PREFIX) ? block.name.slice(TOOL_PREFIX.length) : block.name}`);
        }
        this.appendLog(task.id, lines);
      } else if (m.type === "result") {
        resultText = m.subtype === "success" ? m.result : m.errors.join("; ") || m.subtype;
      }
    }
    return { created, resultText };
  }
}
