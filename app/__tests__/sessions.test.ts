import { afterAll, describe, expect, it } from "vitest";
import { BASE_URL, cleanupTestSessions } from "./helpers";

const PREFIX = "test-sessions-";

afterAll(async () => {
  await cleanupTestSessions(PREFIX);
});

describe("POST /api/sessions", () => {
  it("creates a session and returns id+token", async () => {
    const res = await fetch(`${BASE_URL}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${PREFIX}create-${Date.now()}` }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(typeof data.token).toBe("string");
    expect(data.token.length).toBeGreaterThan(20);
  });

  it("rejects missing name with 400", async () => {
    const res = await fetch(`${BASE_URL}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects empty name with 400", async () => {
    const res = await fetch(`${BASE_URL}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sessions", () => {
  it("lists sessions including the one just created (no token leakage)", async () => {
    const name = `${PREFIX}list-${Date.now()}`;
    await fetch(`${BASE_URL}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const res = await fetch(`${BASE_URL}/api/sessions`);
    expect(res.status).toBe(200);
    const { sessions } = await res.json();
    expect(Array.isArray(sessions)).toBe(true);
    const found = sessions.find((s: { name: string }) => s.name === name);
    expect(found).toBeDefined();
    expect(found).not.toHaveProperty("token");
    expect(found).not.toHaveProperty("tokenHash");
  });
});
