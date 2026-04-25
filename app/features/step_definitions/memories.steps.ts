import { Given, When, Then, Before, After } from "@cucumber/cucumber";
import assert from "node:assert/strict";

const BASE_URL = process.env.HUB_BASE_URL ?? "http://localhost:3000";

interface World {
  sessionId?: string;
  sessionToken?: string;
  lastResponse?: Response;
  lastBody?: any;
}

let world: World = {};

Before(() => {
  world = {};
});

Given("a fresh test session named {string}", async function (name: string) {
  const res = await fetch(`${BASE_URL}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `bdd-${name}-${Date.now()}` }),
  });
  assert.equal(res.status, 201, `session create failed: ${res.status}`);
  const data = await res.json();
  world.sessionId = data.id;
  world.sessionToken = data.token;
});

When(
  "I POST a memory with title {string} and content {string}",
  async function (title: string, content: string) {
    world.lastResponse = await fetch(`${BASE_URL}/api/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${world.sessionToken}`,
      },
      body: JSON.stringify({
        session_id: world.sessionId,
        title,
        content,
        category: "bdd",
      }),
    });
    world.lastBody = await world.lastResponse.json().catch(() => null);
  },
);

When("I POST a memory with no bearer token", async function () {
  world.lastResponse = await fetch(`${BASE_URL}/api/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: world.sessionId,
      title: "no-auth",
    }),
  });
  world.lastBody = await world.lastResponse.json().catch(() => null);
});

When(
  "I POST a memory with title {string} and a forged content_hash {string}",
  async function (title: string, forged: string) {
    world.lastResponse = await fetch(`${BASE_URL}/api/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${world.sessionToken}`,
      },
      body: JSON.stringify({
        session_id: world.sessionId,
        title,
        content: "forged-hash-test",
        content_hash: forged,
      }),
    });
    world.lastBody = await world.lastResponse.json().catch(() => null);
  },
);

Then("the response status is {int}", function (expected: number) {
  assert.equal(world.lastResponse?.status, expected);
});

Then(
  "the response body has a {int}-character content_hash",
  function (length: number) {
    assert.equal(typeof world.lastBody?.contentHash, "string");
    assert.equal((world.lastBody.contentHash as string).length, length);
  },
);

Then(
  "the response content_hash does not equal {string}",
  function (forged: string) {
    assert.notEqual(world.lastBody?.contentHash, forged);
  },
);

After(async function () {
  if (!world.sessionId) return;
  // Cascade-cleanup the test session and its memories.
  await fetch(
    `${BASE_URL}/api/sessions/${world.sessionId}?with_memories=true`,
    {
      method: "DELETE",
      headers: { "X-Admin-Token": process.env.AUTH_SECRET ?? "" },
    },
  ).catch(() => null);
});
