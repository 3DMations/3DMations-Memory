import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  real,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
  bigserial,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow(),
});

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    localEntryId: text("local_entry_id"),
    title: text("title").notNull(),
    content: text("content"),
    category: text("category"),
    tags: text("tags").array().default(sql`'{}'`),
    confidence: real("confidence").default(0.5),
    recurrence: integer("recurrence").default(1),
    contentHash: text("content_hash"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_memories_session_local_id")
      .on(t.sessionId, t.localEntryId)
      .where(sql`${t.localEntryId} IS NOT NULL`),
  ]
);

// Phase 4 — observability. Every sensitive write logs a row.
// `action` is a short verb like "memory.create", "session.delete". `entity_id`
// is the affected row's UUID when applicable. `diff` holds before/after JSON
// or other action-specific payload.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityId: uuid("entity_id"),
    diff: jsonb("diff").default({}),
    requestId: text("request_id"),
    actor: text("actor"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_audit_session").on(t.sessionId, t.createdAt),
    index("idx_audit_action").on(t.action, t.createdAt),
  ]
);

// Phase 6 — self-monitoring. Collector writes one row per metric per tick
// (every 5 min). See instrumentation-node.ts for collection logic and
// app/app/systemhealth/page.tsx for visualization.
export const systemMetrics = pgTable(
  "system_metrics",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
    metadata: jsonb("metadata").default({}),
  },
  (t) => [
    index("idx_metrics_metric_time").on(t.metric, t.recordedAt),
  ]
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
export type SystemMetric = typeof systemMetrics.$inferSelect;
export type NewSystemMetric = typeof systemMetrics.$inferInsert;
