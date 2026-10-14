/**
 * Process-level error boundaries for the LONG-RUNNING entry points (web dashboard, MCP
 * server). These processes are expected to stay up for days across a fleet that is
 * constantly changing underneath them: sessions die mid-request, the tmux server restarts,
 * a pane vanishes between two awaits. A single unhandled rejection would take the whole
 * observability plane down — the worst time to lose visibility is exactly when things break.
 *
 * Policy: record it, keep serving. We deliberately do NOT exit on uncaughtException the way
 * Node's default does, because for this process class a partial failure is strictly better
 * than no dashboard. Fatal-by-nature errors (a bind that fails: EADDRINUSE → 75, anything else → 71)
 * are handled at their own call site where the correct action IS to exit — and handled
 * WITHOUT throwing: a throw inside an event listener reaches this boundary as an uncaughtException
 * and is kept alive here like a running daemon's fault, which on 2026-09-30 measured as a web verb
 * that exited 0 with no banner after a failed listen() (its readiness wait pending, the loop drained).
 */
import { Ledger } from "./ledger.js";

export function installErrorBoundary(ledger: Ledger, component: string): void {
  const record = (kind: string, err: unknown) => {
    const e = err as Error | undefined;
    const detail = {
      component,
      kind,
      message: String(e?.message ?? err).slice(0, 400),
      stack: e?.stack?.split("\n").slice(0, 4).join(" | ").slice(0, 600) ?? null,
    };
    try {
      ledger.emit({ type: "control.denied", actor: component, data: { boundary: detail } });
    } catch {
      /* ledger itself failed — nothing left to do but stay alive */
    }
    console.error(`[${component}] ${kind}: ${detail.message}`);
  };

  process.on("unhandledRejection", (reason) => record("unhandledRejection", reason));
  process.on("uncaughtException", (err) => record("uncaughtException", err));
}
