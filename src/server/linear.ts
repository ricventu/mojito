import { parseIdentifier } from "./sessionKey";
import type { TicketSummary } from "./types";

const ENDPOINT = "https://api.linear.app/graphql";

interface IssueNode {
  identifier?: string;
  title?: string;
  url?: string;
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
    // Asked of the API rather than built from a workspace slug Mojito would have to
    // learn and keep: Linear hands out the canonical url per issue.
    url: node.url ?? "",
    statusName: node.state?.name ?? "",
    statusType: node.state?.type ?? "",
    project: node.project?.name ?? null,
    labels: node.labels?.nodes?.map((l) => l.name) ?? [],
    assignedToMe: node.assignee?.isMe ?? false,
  };
}

/**
 * The open issues Mojito shows on its board — scoped to the projects `projects.json`
 * actually maps. Mojito can only launch a session into a project it has a path
 * for, so a workspace project it knows nothing about had nothing to offer but tickets that
 * answer `no-repo` when you tap them, while still eating the `first: 100` budget the
 * mapped projects share.
 *
 * A ticket with no project at all is scoped out too: Mojito resolves a session's directory
 * from the project, so a project-less ticket is as unlaunchable as an unmapped one.
 *
 * An empty `projects` list scopes nothing and returns the whole workspace, on purpose:
 * loadProjectMap swallows a parse error and answers `{}`, so scoping on it would blank
 * the entire board with no explanation whenever projects.json is malformed.
 */
export async function listOpenIssues(
  apiKey: string,
  projects: readonly string[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<TicketSummary[]> {
  const scoped = projects.length > 0;
  // The variable is declared only when it is used: GraphQL rejects a document that
  // defines a variable it never references.
  const header = scoped ? "query ($projects: [String!]!)" : "query";
  const open = `state: { type: { nin: ["completed", "canceled"] } }`;
  const filter = scoped ? `${open}, project: { name: { in: $projects } }` : open;
  const data = await query<{ issues: { nodes: IssueNode[] } }>(
    apiKey,
    {
      // Every open issue of those projects, not just the viewer's — the "Mine" restriction
      // is a UI filter over `assignedToMe`, so unassigned tickets stay reachable.
      query: `${header} {
        issues(filter: { ${filter} }, first: 100) {
          nodes {
            identifier title url state { name type } project { name }
            labels { nodes { name } } assignee { isMe }
          }
        }
      }`,
      ...(scoped ? { variables: { projects: [...projects] } } : {}),
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

export interface IssueAttachmentRef {
  title: string;
  url: string;
}

/** One comment on the issue, flattened: threading is dropped, chronology is kept. */
export interface IssueComment {
  /** The commenter's display name, the bot's name for an integration comment, "" for neither. */
  author: string;
  createdAt: string;
  body: string;
}

export interface IssueContent {
  description: string;
  attachments: IssueAttachmentRef[];
  comments: IssueComment[];
}

/**
 * The description, the issue's attachment list and its comments in one round trip. Every
 * caller on the launch path wants all three — the description and the comments for the
 * prompt context, the attachments so Mojito can download the ones that are Linear uploads.
 *
 * The comments are here because a ticket's real specification routinely ends up in the
 * thread rather than in the description, and the spawned session holds no Linear
 * credential of its own (RIC-207) — so whatever Mojito does not read at launch is
 * something the session can only get through an MCP round trip it is never told to make.
 * Flattened deliberately: reply threading is structure the session does not need, where
 * chronology is. Linear orders a connection by updatedAt descending, so `first: 50` on a
 * very long thread is the 50 most recently touched comments, sorted back into order here.
 */
export async function getIssueContent(
  apiKey: string,
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IssueContent> {
  const { teamKey, number } = parseIdentifier(identifier);
  const data = await query<{
    issues: {
      nodes: {
        description?: string | null;
        attachments?: { nodes?: { title?: string | null; url?: string | null }[] };
        comments?: {
          nodes?: {
            body?: string | null;
            createdAt?: string | null;
            user?: { displayName?: string | null } | null;
            botActor?: { name?: string | null } | null;
          }[];
        };
      }[];
    };
  }>(
    apiKey,
    {
      query: `query ($key: String!, $n: Float!) {
        issues(filter: { team: { key: { eq: $key } }, number: { eq: $n } }, first: 1) {
          nodes {
            description
            attachments(first: 25) { nodes { title url } }
            comments(first: 50) {
              nodes { body createdAt user { displayName } botActor { name } }
            }
          }
        }
      }`,
      variables: { key: teamKey, n: number },
    },
    fetchImpl,
  );
  const node = data.issues.nodes[0];
  if (!node) throw new Error(`issue not found: ${identifier}`);
  const attachments: IssueAttachmentRef[] = [];
  for (const a of node.attachments?.nodes ?? []) {
    if (typeof a?.url === "string" && a.url) attachments.push({ title: a.title ?? "", url: a.url });
  }
  // A comment with no body is a deleted one or an image-only one the session cannot see:
  // it carries nothing, and every row here is paid for in the session's context window.
  const comments: IssueComment[] = [];
  for (const c of node.comments?.nodes ?? []) {
    if (typeof c?.body !== "string" || !c.body) continue;
    comments.push({
      author: c.user?.displayName ?? c.botActor?.name ?? "",
      createdAt: c.createdAt ?? "",
      body: c.body,
    });
  }
  comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { description: node.description ?? "", attachments, comments };
}

const ASSET_TIMEOUT_MS = 15_000;

/**
 * Fetch one `uploads.linear.app` asset. Linear serves these only to a request carrying
 * the API key, and a spawned session never has one — so Mojito pulls the bytes at launch
 * instead. Redirects are followed to the signed storage URL; `fetch` drops the
 * Authorization header on that cross-origin hop, which is correct: the target is
 * pre-signed. Size is checked twice because `content-length` is advisory: the header
 * check rejects an oversized asset before it is buffered only when the header is present
 * and honest — an absent or lying header still means an unbounded `arrayBuffer()` read,
 * which is what the post-read check below catches instead.
 */
export async function downloadLinearAsset(
  apiKey: string,
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Buffer; contentType: string }> {
  // The caller only ever hands over URLs that already passed isLinearUploadUrl, but the
  // API key leaves the process here — so the host is re-checked where the credential is
  // attached rather than trusted from one layer up. `hostname` (not `host`) is what makes
  // userinfo tricks like https://uploads.linear.app@evil.com/ fail.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid Linear asset URL");
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "uploads.linear.app") {
    throw new Error(`refusing to send the Linear API key to ${parsed.host}`);
  }

  const res = await fetchImpl(url, {
    headers: { Authorization: apiKey },
    signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Linear asset download failed: ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Linear asset too large: ${declared} bytes`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`Linear asset too large: ${bytes.length} bytes`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return { bytes, contentType };
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
