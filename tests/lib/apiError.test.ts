import { describe, it, expect } from "vitest";
import { apiError } from "@/lib/apiError";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

describe("apiError", () => {
  it("returns the route's own error message", async () => {
    expect(await apiError(json({ error: "duplicate" }, 409), "launch failed"))
      .toBe("duplicate");
  });

  it("falls back to the status code when the body is not JSON", async () => {
    const res = new Response("<html>502 Bad Gateway</html>", { status: 502 });
    expect(await apiError(res, "launch failed")).toBe("launch failed (502)");
  });

  it("falls back when the JSON carries no error field", async () => {
    expect(await apiError(json({ id: "mojito-RIC-1-work" }, 422), "launch failed"))
      .toBe("launch failed (422)");
  });

  it("falls back on an empty body", async () => {
    expect(await apiError(new Response(null, { status: 500 }), "launch failed")).toBe("launch failed (500)");
  });

  it("stringifies a non-string error field rather than rendering [object Object]", async () => {
    expect(await apiError(json({ error: 42 }, 400), "launch failed")).toBe("42");
  });
});
