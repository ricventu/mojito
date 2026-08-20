import type { SessionMeta } from "./types";
import { listSidecars, readSidecar, writeSidecar, removeSidecar } from "./sidecar";

export class Registry {
  private map = new Map<string, SessionMeta>();
  constructor(private stateDir: string) {
    for (const m of listSidecars(stateDir)) this.map.set(m.id, m);
  }
  get(id: string): SessionMeta | undefined {
    return this.map.get(id);
  }
  all(): SessionMeta[] {
    return [...this.map.values()];
  }
  upsert(meta: SessionMeta): void {
    this.map.set(meta.id, meta);
    writeSidecar(this.stateDir, meta);
  }
  patch(id: string, partial: Partial<SessionMeta>): SessionMeta | undefined {
    const current = this.map.get(id) ?? readSidecar(this.stateDir, id) ?? undefined;
    if (!current) return undefined;
    const next = { ...current, ...partial };
    this.upsert(next);
    return next;
  }
  remove(id: string): void {
    this.map.delete(id);
    removeSidecar(this.stateDir, id);
  }
  recover(liveSessionNames: string[]): void {
    const live = new Set(liveSessionNames);
    for (const m of this.all()) {
      if (!live.has(m.id) && m.state !== "done") this.patch(m.id, { state: "failed" });
    }
  }
}
