import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }>;

/**
 * Calls a tool of an in-process SDK MCP server the way the CLI would reach it. The handler
 * table is the McpServer's private `_registeredTools`: the SDK exposes no public way to call a
 * tool without a transport, and this is the narrowest seam to a real handler.
 */
export function callTool(server: unknown, name: string, args: Record<string, unknown>) {
  const instance = (server as McpSdkServerConfigWithInstance).instance as unknown as {
    _registeredTools: Record<string, { handler: Handler }>;
  };
  const registered = instance._registeredTools[name];
  if (!registered) throw new Error(`no tool ${name}`);
  return registered.handler(args, {});
}
