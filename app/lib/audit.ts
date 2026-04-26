import { db } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditAction =
  | "session.create"
  | "session.delete"
  | "memory.create"
  | "memory.upsert.update";

interface LogArgs {
  action: AuditAction;
  sessionId: string | null;
  entityId?: string | null;
  diff?: Record<string, unknown>;
  requestId?: string | null;
  actor?: string | null;
}

// Fire-and-forget audit row. Failures should NOT break the request that triggered
// the audit; we log to console.error and move on.
export async function logAudit(args: LogArgs): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action: args.action,
      sessionId: args.sessionId,
      entityId: args.entityId ?? null,
      diff: args.diff ?? {},
      requestId: args.requestId ?? null,
      actor: args.actor ?? null,
    });
  } catch (err) {
    console.error("audit log insert failed", {
      action: args.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Pull a request id from common headers, otherwise null.
// Tailscale Serve doesn't inject one, so we accept X-Request-ID if a client sends it.
export function requestIdFrom(req: Request): string | null {
  return req.headers.get("x-request-id");
}

// Tailscale-User-Login if present, otherwise null. Used as the actor field.
export function actorFrom(req: Request): string | null {
  return req.headers.get("tailscale-user-login");
}
