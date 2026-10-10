import { ollamaHealth } from "@/lib/ollama";

export async function GET() {
  if (process.env.AI_FEATURES_ENABLED !== "true") {
    return Response.json(
      { ok: false, reason: "AI features disabled" },
      { status: 503 }
    );
  }
  try {
    const { models } = await ollamaHealth();
    return Response.json({
      ok: true,
      model: process.env.OLLAMA_MODEL ?? "qwen3.6:35b",
      available: models.map((m) => m.name),
    });
  } catch (err) {
    // Node fetch errors embed the target URL — keep that out of responses
    // (audit 2026-10-10); log server-side instead.
    console.error("[ai-health] ollama check failed:", err);
    return Response.json({ ok: false }, { status: 503 });
  }
}
