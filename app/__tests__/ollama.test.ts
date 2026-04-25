import { describe, expect, it } from "vitest";
import { ollamaHealth } from "@/lib/ollama";

describe("Ollama integration (Phase 1.5 plumbing)", () => {
  it("reaches jarvis-ollama and returns the configured model in the tag list", async () => {
    const { models } = await ollamaHealth();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    const configured = process.env.OLLAMA_MODEL ?? "qwen3.6:35b";
    const names = models.map((m) => m.name);
    expect(names).toContain(configured);
  });
});
