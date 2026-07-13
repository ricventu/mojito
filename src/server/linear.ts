import { parseIdentifier } from "./sessionKey.js";
import type { TicketSummary } from "./types.js";

const ENDPOINT = "https://api.linear.app/graphql";

interface IssueNode {
  identifier?: string;
  title?: string;
  state?: { name?: string; type?: string };
  project?: { name?: string } | null;
  labels?: { nodes?: { name: string }[] };
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
  };
}

export async function listOpenIssues(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<TicketSummary[]> {
  const data = await query<{ issues: { nodes: IssueNode[] } }>(
    apiKey,
    {
      query: `query {
        issues(filter: {
          assignee: { isMe: { eq: true } },
          state: { type: { nin: ["completed", "canceled"] } }
        }, first: 100) {
          nodes { identifier title state { name type } project { name } labels { nodes { name } } }
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
