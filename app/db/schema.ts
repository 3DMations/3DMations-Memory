import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  real,
  jsonb,
  uniqueIndex,
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
      onDelete: "cascade",
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

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
