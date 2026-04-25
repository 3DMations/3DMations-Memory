import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, cleanupTestSessions, createSession } from "./helpers";

const PREFIX = "test-compare-";

let sessA: { id: string; token: string };
let sessB: { id: string; token: string };

async function postMemory(s: { id: string; token: string }, title: string) {
  return fetch(`${BASE_URL}/api/memories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${s.token}`,
    },
    body: JSON.stringify({ session_id: s.id, title }),
  });
}

beforeAll(async () => {
  sessA = await createSession(`${PREFIX}A-${Date.now()}`);
  sessB = await createSession(`${PREFIX}B-${Date.now()}`);

  await postMemory(sessA, "PostgreSQL trigram performance notes");
  await postMemory(sessA, "Drizzle UPSERT requires targetWhere for partial unique index");
  await postMemory(sessA, "Only-A topic — kafka schema registry");

  await postMemory(sessB, "PostgreSQL trigram performance notes");
  await postMemory(sessB, "Drizzle UPSERT needs targetWhere for partial unique index");
  await postMemory(sessB, "Only-B topic — typescript discriminated unions");
});

afterAll(async () => {
  await cleanupTestSessions(PREFIX);
});

describe("GET /api/memories/compare", () => {
  it("returns 401 without bearer token", async () => {
    const res = await fetch(
      `${BASE_URL}/api/memories/compare?a=${sessA.id}&b=${sessB.id}`
    );
    expect(res.status).toBe(401);
  });

  it("returns three-bucket structure when given two sessions with overlap", async () => {
    const res = await fetch(
      `${BASE_URL}/api/memories/compare?a=${sessA.id}&b=${sessB.id}`,
      { headers: { Authorization: `Bearer ${sessA.token}` } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.a.id).toBe(sessA.id);
    expect(data.b.id).toBe(sessB.id);
    expect(data.threshold).toBe(0.4);

    expect(Array.isArray(data.in_both)).toBe(true);
    expect(Array.isArray(data.in_a_only)).toBe(true);
    expect(Array.isArray(data.in_b_only)).toBe(true);

    expect(data.in_both.length).toBeGreaterThanOrEqual(1);
    const titlesA = data.in_a_only.map((m: { title: string }) => m.title);
    const titlesB = data.in_b_only.map((m: { title: string }) => m.title);
    expect(titlesA.some((t: string) => t.includes("kafka"))).toBe(true);
    expect(titlesB.some((t: string) => t.includes("typescript"))).toBe(true);

    for (const pair of data.in_both) {
      expect(pair.sim).toBeGreaterThan(0.4);
    }
  });

  it("respects custom threshold", async () => {
    const lo = await fetch(
      `${BASE_URL}/api/memories/compare?a=${sessA.id}&b=${sessB.id}&threshold=0.1`,
      { headers: { Authorization: `Bearer ${sessA.token}` } }
    );
    const hi = await fetch(
      `${BASE_URL}/api/memories/compare?a=${sessA.id}&b=${sessB.id}&threshold=0.9`,
      { headers: { Authorization: `Bearer ${sessA.token}` } }
    );
    const lowData = await lo.json();
    const highData = await hi.json();

    expect(lowData.threshold).toBe(0.1);
    expect(highData.threshold).toBe(0.9);
    expect(lowData.in_both.length).toBeGreaterThanOrEqual(highData.in_both.length);
    expect(highData.counts.in_a_only + highData.counts.in_both).toBe(3);
    expect(lowData.counts.in_a_only + lowData.counts.in_both).toBe(3);
  });
});
