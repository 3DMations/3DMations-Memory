import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memories } from "@/db/schema";
import { ollama } from "@/lib/ollama";
import { requireAdmin } from "@/lib/tailscale-identity";

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/memories/:id/promote
// Asks Ollama to format a memory into a Claude Code skill markdown stub
// (frontmatter + when-to-use + steps). Caller pastes the result into
// `~/.claude/skills/<name>/SKILL.md` themselves — the hub does NOT write
// to the user's filesystem.
export async function POST(request: Request, { params }: Params) {
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

  const { id } = await params;

  const [m] = await db
    .select()
    .from(memories)
    .where(eq(memories.id, id))
    .limit(1);
  if (!m) {
    return Response.json({ error: "memory not found" }, { status: 404 });
  }

  const prompt = [
    "Convert this memory into a Claude Code skill markdown file.",
    "Output ONLY the markdown — no explanation, no code fences around the whole thing.",
    "Include YAML frontmatter with name (kebab-case derived from the title) and a one-line description.",
    "Then sections: ## When to use, ## Steps, ## Notes.",
    "Keep total length under 80 lines.",
    "",
    "Memory:",
    JSON.stringify(
      {
        title: m.title,
        content: m.content,
        category: m.category,
        tags: m.tags,
        recurrence: m.recurrence,
      },
      null,
      2,
    ),
  ].join("\n");

  try {
    const completion = await ollama.chat.completions.create({
      model: process.env.OLLAMA_MODEL ?? "qwen3.6:35b",
      messages: [{ role: "user", content: prompt }],
    });
    const markdown = completion.choices[0]?.message?.content ?? "";
    return Response.json({
      memory_id: m.id,
      title: m.title,
      markdown,
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
