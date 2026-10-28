import type { TicketSummary } from "@mojito/shared";

const ENDPOINT = "https://api.linear.app/graphql";
const TICKET_RE = /^([A-Z][A-Z0-9]*)-(\d+)$/;

interface IssueNode {
  identifier?: string;
  title?: string;
  url?: string;
  state?: { name?: string; type?: string };
  project?: { name?: string } | null;
  labels?: { nodes?: { name: string }[] };
  assignee?: { isMe?: boolean } | null;
}

function parseIdentifier(ticket: string): { teamKey: string; number: number } {
  const m = TICKET_RE.exec(ticket);
  if (!m) throw new Error(`invalid ticket id: ${ticket}`);
  return { teamKey: m[1], number: Number(m[2]) };
}

function mapIssueNode(node: IssueNode): TicketSummary {
  return {
    identifier: node.identifier ?? "",
    title: node.title ?? "",
    // Linear hands out the canonical url per issue; no workspace slug to learn and keep.
    url: node.url ?? "",
    statusName: node.state?.name ?? "",
    statusType: node.state?.type ?? "",
    project: node.project?.name ?? null,
    labels: node.labels?.nodes?.map((l) => l.name) ?? [],
    assignedToMe: node.assignee?.isMe ?? false,
  };
}

/** Direct GraphQL client for Linear. Every value reaches the API as a variable, never interpolated. */
export class LinearClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async query<T>(body: object): Promise<T> {
    const res = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: this.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Linear API error: ${res.status}`);
    const json = (await res.json()) as { data: T; errors?: unknown };
    if (json.errors) throw new Error("Linear GraphQL error");
    return json.data;
  }

  /**
   * The open issues of the given projects (every open issue of the workspace when the list is
   * empty: a malformed projects map must not blank the board). Not just the viewer's: "Mine"
   * is a UI filter over `assignedToMe`.
   */
  async listOpenIssues(projects: readonly string[]): Promise<TicketSummary[]> {
    const scoped = projects.length > 0;
    // The variable is declared only when used: GraphQL rejects a document defining an unused one.
    const header = scoped ? "query ($projects: [String!]!)" : "query";
    const open = `state: { type: { nin: ["completed", "canceled"] } }`;
    const filter = scoped ? `${open}, project: { name: { in: $projects } }` : open;
    const data = await this.query<{ issues: { nodes: IssueNode[] } }>({
      query: `${header} {
        issues(filter: { ${filter} }, first: 100) {
          nodes {
            identifier title url state { name type } project { name }
            labels { nodes { name } } assignee { isMe }
          }
        }
      }`,
      ...(scoped ? { variables: { projects: [...projects] } } : {}),
    });
    return data.issues.nodes
      .map(mapIssueNode)
      .sort((a, b) => (a.project ?? "").localeCompare(b.project ?? "") || a.identifier.localeCompare(b.identifier));
  }

  /** The team's workflow state names, in board order. */
  async listTeamStates(teamKey: string): Promise<string[]> {
    const data = await this.query<{ teams: { nodes: { states: { nodes: { name: string; position: number }[] } }[] } }>({
      query: `query ($key: String!) {
        teams(filter: { key: { eq: $key } }) { nodes { states { nodes { name position } } } }
      }`,
      variables: { key: teamKey },
    });
    const team = data.teams.nodes[0];
    if (!team) throw new Error(`team not found: ${teamKey}`);
    return [...team.states.nodes].sort((a, b) => a.position - b.position).map((s) => s.name);
  }

  async setStatus(identifier: string, stateName: string): Promise<void> {
    const ref = await this.issueRef(identifier);
    const states = await this.query<{ team: { states: { nodes: { id: string; name: string }[] } } }>({
      query: `query ($teamId: String!) {
        team(id: $teamId) { states { nodes { id name } } }
      }`,
      variables: { teamId: ref.teamId },
    });
    const target = states.team.states.nodes.find((s) => s.name === stateName);
    if (!target) throw new Error(`workflow state "${stateName}" not found in team`);
    await this.query<{ issueUpdate: { success: boolean } }>({
      query: `mutation ($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) { success }
      }`,
      variables: { id: ref.id, stateId: target.id },
    });
  }

  /** Assigns the issue to the API key's owner. */
  async assignToMe(identifier: string): Promise<void> {
    const ref = await this.issueRef(identifier);
    const viewer = await this.query<{ viewer: { id: string } }>({ query: `query { viewer { id } }` });
    await this.query<{ issueUpdate: { success: boolean } }>({
      query: `mutation ($id: String!, $assigneeId: String) {
        issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success }
      }`,
      variables: { id: ref.id, assigneeId: viewer.viewer.id },
    });
  }

  async uploadImage(file: { filename: string; contentType: string; size: number; bytes: Uint8Array }): Promise<string> {
    const data = await this.query<{
      fileUpload: {
        success: boolean;
        uploadFile?: { uploadUrl: string; assetUrl: string; headers: { key: string; value: string }[] };
      };
    }>({
      query: `mutation ($size: Int!, $contentType: String!, $filename: String!) {
        fileUpload(size: $size, contentType: $contentType, filename: $filename) {
          success
          uploadFile { uploadUrl assetUrl headers { key value } }
        }
      }`,
      variables: { size: file.size, contentType: file.contentType, filename: file.filename },
    });
    const uf = data.fileUpload.uploadFile;
    if (!data.fileUpload.success || !uf) throw new Error("Linear fileUpload failed");
    const headers: Record<string, string> = { "Content-Type": file.contentType };
    for (const h of uf.headers) headers[h.key] = h.value;
    const put = await this.fetchImpl(uf.uploadUrl, { method: "PUT", headers, body: file.bytes as unknown as Buffer });
    if (!put.ok) throw new Error(`Linear asset upload failed: ${put.status}`);
    return uf.assetUrl;
  }

  async listLabels(teamKey: string): Promise<{ id: string; name: string }[]> {
    const data = await this.query<{ teams: { nodes: { labels: { nodes: { id: string; name: string }[] } }[] } }>({
      query: `query ($key: String!) {
        teams(filter: { key: { eq: $key } }) { nodes { labels(first: 250) { nodes { id name } } } }
      }`,
      variables: { key: teamKey },
    });
    const team = data.teams.nodes[0];
    if (!team) throw new Error(`team not found: ${teamKey}`);
    return team.labels.nodes.map((l) => ({ id: l.id, name: l.name }));
  }

  async createIssue(input: {
    teamKey: string;
    project: string;
    title: string;
    description: string;
    labelId?: string;
  }): Promise<{ identifier: string; url: string }> {
    const data = await this.query<{ teams: { nodes: { id: string; projects: { nodes: { id: string }[] } }[] } }>({
      query: `query ($key: String!, $name: String!) {
        teams(filter: { key: { eq: $key } }) {
          nodes { id projects(filter: { name: { eq: $name } }, first: 1) { nodes { id } } }
        }
      }`,
      variables: { key: input.teamKey, name: input.project },
    });
    const team = data.teams.nodes[0];
    if (!team) throw new Error(`team not found: ${input.teamKey}`);
    const project = team.projects.nodes[0];
    if (!project) throw new Error(`project "${input.project}" not found in team ${input.teamKey}`);
    const created = await this.query<{
      issueCreate: { success: boolean; issue?: { identifier: string; url: string } };
    }>({
      query: `mutation ($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { identifier url } }
      }`,
      variables: {
        input: {
          teamId: team.id,
          projectId: project.id,
          title: input.title,
          description: input.description,
          ...(input.labelId ? { labelIds: [input.labelId] } : {}),
        },
      },
    });
    const issue = created.issueCreate.issue;
    if (!created.issueCreate.success || !issue) throw new Error("Linear issueCreate failed");
    return { identifier: issue.identifier, url: issue.url };
  }

  private async issueRef(identifier: string): Promise<{ id: string; teamId: string }> {
    const { teamKey, number } = parseIdentifier(identifier);
    const data = await this.query<{ issues: { nodes: { id?: string; team?: { id?: string } }[] } }>({
      query: `query ($key: String!, $n: Float!) {
        issues(filter: { team: { key: { eq: $key } }, number: { eq: $n } }, first: 1) {
          nodes { id team { id } }
        }
      }`,
      variables: { key: teamKey, n: number },
    });
    const node = data.issues.nodes[0];
    if (!node?.id || !node.team?.id) throw new Error(`issue not found: ${identifier}`);
    return { id: node.id, teamId: node.team.id };
  }
}
