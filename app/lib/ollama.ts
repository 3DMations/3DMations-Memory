import OpenAI from "openai";

const BASE_URL = process.env.OLLAMA_URL ?? "http://jarvis-ollama:11434";

export const ollama = new OpenAI({
  baseURL: BASE_URL + "/v1",
  apiKey: "ollama",
});

export interface OllamaTagsResponse {
  models: Array<{
    name: string;
    size: number;
    digest?: string;
    modified_at?: string;
  }>;
}

export async function ollamaHealth(): Promise<OllamaTagsResponse> {
  const res = await fetch(`${BASE_URL}/api/tags`);
  if (!res.ok) {
    throw new Error(`Ollama unreachable: HTTP ${res.status}`);
  }
  return (await res.json()) as OllamaTagsResponse;
}
