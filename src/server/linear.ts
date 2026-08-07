import { parseIdentifier } from "./sessionKey.js";
import type { TicketSummary } from "./types.js";

const ENDPOINT = "https://api.linear.app/graphql";

interface IssueNode {
  identifier?: string;
  title?: string;
  state?: { name?: string; type?: string };
  project?: { name?: string } | null;
  labels?: { nodes?: { name: string }[] };
  assignee?: { isMe?: boolean } | null;
}

async function query<T>(apiKey: string, body: object, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Linear API error: ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: unknown };
  if ((json as { errors?: unknown }).errors) throw new Error("Linear GraphQL error");
  return json.data;
}

function mapIssueNode(node: IssueNode): TicketSummary {
  return {
    identifier: node.identifier ?? "",
    title: node.title ?? "",
    statusName: node.state?.name ?? "",
    statusType: node.state?.type ?? "",
    project: node.project?.name ?? null,
    labels: node.labels?.nodes?.map((l) => l.name) ?? [],
    assignedToMe: node.assignee?.isMe ?? false,
  };
}

export async function listOpenIssues(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<TicketSummary[]> {
  const data = await query<{ issues: { nodes: IssueNode[] } }>(
    apiKey,
    {
      // Every open issue, not just the viewer's — the "Mine" restriction is a UI filter
      // over `assignedToMe`, so unassigned tickets stay reachable from Mojito.
      query: `query {
        issues(filter: {
          state: { type: { nin: ["completed", "canceled"] } }
        }, first: 100) {
          nodes {
            identifier title state { name type } project { name }
            labels { nodes { name } } assignee { isMe }
          }
        }
      }`,
    },
    fetchImpl,
  );
  return data.issues.nodes
    .map(mapIssueNode)
    .sort((a, b) => (a.project ?? "").localeCompare(b.project ?? "") || a.identifier.localeCompare(b.identifier));
}

export async function getIssueStatus(apiKey: string, identifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { teamKey, number } = parseIdentifier(identifier);
  const data = await query<{ issues: { nodes: { state?: { name?: string } }[] } }>(
    apiKey,
    {
      query: `query ($key: String!, $n: Float!) {
        issues(filter: { team: { key: { eq: $key } }, number: { eq: $n } }, first: 1) {
          nodes { state { name } }
        }
      }`,
      variables: { key: teamKey, n: number },
    },
    fetchImpl,
  );
  const name = data.issues.nodes[0]?.state?.name;
  if (!name) throw new Error(`issue not found: ${identifier}`);
  return name;
}

export async function getIssueRef(
  apiKey: string,
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; teamId: string; statusName: string }> {
  const { teamKey, number } = parseIdentifier(identifier);
  const data = await query<{ issues: { nodes: { id?: string; state?: { name?: string }; team?: { id?: string } }[] } }>(
    apiKey,
    {
      query: `query ($key: String!, $n: Float!) {
        issues(filter: { team: { key: { eq: $key } }, number: { eq: $n } }, first: 1) {
          nodes { id state { name } team { id } }
        }
      }`,
      variables: { key: teamKey, n: number },
    },
    fetchImpl,
  );
  const node = data.issues.nodes[0];
  if (!node?.id || !node.team?.id) throw new Error(`issue not found: ${identifier}`);
  return { id: node.id, teamId: node.team.id, statusName: node.state?.name ?? "" };
}

export async function getIssueDescription(
  apiKey: string,
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { teamKey, number } = parseIdentifier(identifier);
  const data = await query<{ issues: { nodes: { description?: string | null }[] } }>(
    apiKey,
    {
      query: `query ($key: String!, $n: Float!) {
        issues(filter: { team: { key: { eq: $key } }, number: { eq: $n } }, first: 1) {
          nodes { description }
        }
      }`,
      variables: { key: teamKey, n: number },
    },
    fetchImpl,
  );
  const node = data.issues.nodes[0];
  if (!node) throw new Error(`issue not found: ${identifier}`);
  return node.description ?? "";
}

export async function createIssue(
  apiKey: string,
  input: { teamKey: string; title: string; description: string; projectName: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<{ identifier: string }> {
  const teams = await query<{ teams: { nodes: { id: string; key: string }[] } }>(
    apiKey,
    {
      query: `query ($key: String!) { teams(filter: { key: { eq: $key } }, first: 1) { nodes { id key } } }`,
      variables: { key: input.teamKey },
    },
    fetchImpl,
  );
  const team = teams.teams.nodes[0];
  if (!team) throw new Error(`team not found: ${input.teamKey}`);

  // An unknown project name degrades to "no project" rather than failing the creation.
  let projectId: string | undefined;
  if (input.projectName) {
    const projects = await query<{ projects: { nodes: { id: string; name: string }[] } }>(
      apiKey,
      {
        query: `query ($name: String!) { projects(filter: { name: { eq: $name } }, first: 1) { nodes { id name } } }`,
        variables: { name: input.projectName },
      },
      fetchImpl,
    );
    projectId = projects.projects.nodes[0]?.id;
  }

  const created = await query<{ issueCreate: { success: boolean; issue?: { identifier?: string } } }>(
    apiKey,
    {
      query: `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier } } }`,
      variables: {
        input: {
          teamId: team.id,
          title: input.title,
          description: input.description,
          ...(projectId ? { projectId } : {}),
        },
      },
    },
    fetchImpl,
  );
  const identifier = created.issueCreate.issue?.identifier;
  if (!created.issueCreate.success || !identifier) throw new Error("Linear issueCreate failed");
  return { identifier };
}

export async function setIssueStatus(
  apiKey: string,
  identifier: string,
  targetStateName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const ref = await getIssueRef(apiKey, identifier, fetchImpl);
  const states = await query<{ team: { states: { nodes: { id: string; name: string }[] } } }>(
    apiKey,
    {
      query: `query ($teamId: String!) {
        team(id: $teamId) { states { nodes { id name } } }
      }`,
      variables: { teamId: ref.teamId },
    },
    fetchImpl,
  );
  const target = states.team.states.nodes.find((s) => s.name === targetStateName);
  if (!target) throw new Error(`workflow state "${targetStateName}" not found in team`);
  await query<{ issueUpdate: { success: boolean } }>(
    apiKey,
    {
      query: `mutation ($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) { success }
      }`,
      variables: { id: ref.id, stateId: target.id },
    },
    fetchImpl,
  );
}

/**
 * Assign an issue to the API key's owner, or clear its assignee.
 * The viewer lookup is skipped when unassigning — `null` needs no id.
 */
export async function setIssueAssignee(
  apiKey: string,
  identifier: string,
  toMe: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const ref = await getIssueRef(apiKey, identifier, fetchImpl);
  let assigneeId: string | null = null;
  if (toMe) {
    const viewer = await query<{ viewer: { id: string } }>(apiKey, { query: `query { viewer { id } }` }, fetchImpl);
    assigneeId = viewer.viewer.id;
  }
  await query<{ issueUpdate: { success: boolean } }>(
    apiKey,
    {
      query: `mutation ($id: String!, $assigneeId: String) {
        issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success }
      }`,
      variables: { id: ref.id, assigneeId },
    },
    fetchImpl,
  );
}

export async function postComment(
  apiKey: string,
  identifier: string,
  body: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const ref = await getIssueRef(apiKey, identifier, fetchImpl);
  await query<{ commentCreate: { success: boolean } }>(
    apiKey,
    {
      query: `mutation ($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) { success }
      }`,
      variables: { issueId: ref.id, body },
    },
    fetchImpl,
  );
}

export async function uploadImage(
  apiKey: string,
  file: { filename: string; contentType: string; size: number; bytes: Uint8Array },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const data = await query<{
    fileUpload: {
      success: boolean;
      uploadFile?: { uploadUrl: string; assetUrl: string; headers: { key: string; value: string }[] };
    };
  }>(
    apiKey,
    {
      query: `mutation ($size: Int!, $contentType: String!, $filename: String!) {
        fileUpload(size: $size, contentType: $contentType, filename: $filename) {
          success
          uploadFile { uploadUrl assetUrl headers { key value } }
        }
      }`,
      variables: { size: file.size, contentType: file.contentType, filename: file.filename },
    },
    fetchImpl,
  );
  const uf = data.fileUpload.uploadFile;
  if (!data.fileUpload.success || !uf) throw new Error("Linear fileUpload failed");
  const headers: Record<string, string> = { "Content-Type": file.contentType };
  for (const h of uf.headers) headers[h.key] = h.value;
  const put = await fetchImpl(uf.uploadUrl, { method: "PUT", headers, body: file.bytes as BodyInit });
  if (!put.ok) throw new Error(`Linear asset upload failed: ${put.status}`);
  return uf.assetUrl;
}
