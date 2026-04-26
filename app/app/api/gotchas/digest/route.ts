import { desc, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { memories, sessions } from "@/db/schema";
import { ollama } from "@/lib/ollama";
import { requireAdmin } from "@/lib/tailscale-identity";

const DEFAULT_THRESHOLD = 3;

export async function POST(request: Request) {
  if (process.env.AI_FEATURES_ENABLED !== "true") {
    return Response.json(
      { error: "AI features disabled. Set AI_FEATURES_ENABLED=true in .env." },
      { status: 503 },
    );
  }

  const auth = requireAdmin(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const minRaw = parseInt(url.searchParams.get("min") ?? "", 10);
  const min =
    Number.isFinite(minRaw) && minRaw >= 1 ? minRaw : DEFAULT_THRESHOLD;

  const gotchas = await db
    .select({
      title: memories.title,
      content: memories.content,
      category: memories.category,
      recurrence: memories.recurrence,
      sessionName: sessions.name,
    })
    .from(memories)
    .leftJoin(sessions, sql`${memories.sessionId} = ${sessions.id}`)
    .where(gte(memories.recurrence, min))
    .orderBy(desc(memories.recurrence))
    .limit(50);

  if (gotchas.length === 0) {
    return Response.json({
      digest: "No recurring gotchas this week — nothing has hit the threshold.",
      gotcha_count: 0,
    });
  }

  const prompt = [
    "You are summarizing recurring engineering gotchas from a personal memory hub.",
    "Each gotcha has a title, optional content, category, recurrence count, and source session.",
    "Produce a concise weekly digest in markdown:",
    "- Group by theme",
    "- Surface the highest-recurrence items first",
    "- For each, suggest one preventative rule a future Claude session could follow",
    "Keep the whole digest under 600 words.",
    "",
    "Data:",
    JSON.stringify(gotchas, null, 2),
  ].join("\n");

  try {
    const completion = await ollama.chat.completions.create({
      model: process.env.OLLAMA_MODEL ?? "qwen3.6:35b",
      messages: [{ role: "user", content: prompt }],
    });
    const digest = completion.choices[0]?.message?.content ?? "";
    return Response.json({
      digest,
      gotcha_count: gotchas.length,
      model: process.env.OLLAMA_MODEL ?? "qwen3.6:35b",
    });
  } catch (err) {
    return Response.json(
      {
        error: "Ollama call failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
