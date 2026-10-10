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

// Pull a request id from the upstream proxy, otherwise null. Only well-formed
// UUIDs are accepted — proxy.ts generates one for anything else, so a client
// cannot forge arbitrary correlation IDs into the audit trail
// (audit 2026-10-10). Tailscale Serve doesn't inject one itself.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestIdFrom(req: Request): string | null {
  const id = req.headers.get("x-request-id");
  return id && UUID_RE.test(id) ? id : null;
}

// Tailscale-User-Login if present, otherwise null. Used as the actor field.
export function actorFrom(req: Request): string | null {
  return req.headers.get("tailscale-user-login");
}
