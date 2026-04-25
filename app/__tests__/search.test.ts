import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, cleanupTestSessions, createSession } from "./helpers";

const PREFIX = "test-search-";

let sessA: { id: string; token: string };
let sessB: { id: string; token: string };

async function postMemory(s: { id: string; token: string }, title: string, content?: string) {
  return fetch(`${BASE_URL}/api/memories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${s.token}`,
    },
    body: JSON.stringify({ session_id: s.id, title, content }),
  });
}

beforeAll(async () => {
  sessA = await createSession(`${PREFIX}A-${Date.now()}`);
  sessB = await createSession(`${PREFIX}B-${Date.now()}`);
  await postMemory(sessA, "Docker volume mounting tricks");
  await postMemory(sessB, "Docker networking on Linux", "host.docker.internal pitfalls");
  await postMemory(sessB, "Unrelated kitchen recipe");
});

afterAll(async () => {
  await cleanupTestSessions(PREFIX);
});

describe("GET /api/memories/search — global trigram search", () => {
  it("returns 401 without bearer token", async () => {
    const res = await fetch(`${BASE_URL}/api/memories/search?q=docker`);
    expect(res.status).toBe(401);
  });

  it("returns 400 when q is missing or empty", async () => {
    const r1 = await fetch(`${BASE_URL}/api/memories/search`, {
      headers: { Authorization: `Bearer ${sessA.token}` },
    });
    expect(r1.status).toBe(400);
    const r2 = await fetch(`${BASE_URL}/api/memories/search?q=%20`, {
      headers: { Authorization: `Bearer ${sessA.token}` },
    });
    expect(r2.status).toBe(400);
  });

  it("returns hits across multiple sessions with session attribution", async () => {
    const res = await fetch(`${BASE_URL}/api/memories/search?q=docker`, {
      headers: { Authorization: `Bearer ${sessA.token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.query).toBe("docker");
    expect(data.results.length).toBeGreaterThanOrEqual(2);

    const sessionIds = new Set(
      data.results
        .filter((r: { sessionId: string | null }) => r.sessionId)
        .map((r: { sessionId: string }) => r.sessionId)
    );
    expect(sessionIds.has(sessA.id)).toBe(true);
    expect(sessionIds.has(sessB.id)).toBe(true);

    expect(
      data.results.some((r: { sessionName: string | null }) =>
        r.sessionName?.startsWith(PREFIX)
      )
    ).toBe(true);
  });
});
