// Shared "boot the test stack" routine used by both Vitest globalSetup and
// Playwright globalSetup. Starts a throwaway Postgres container, applies the
// schema (drizzle-kit push + post-push-init.sql), and spawns `next dev`
// against that container on a free port. Returns the connection details and
// a teardown function that stops everything cleanly.

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { spawnSync, spawn } from "node:child_process";
import { Client } from "pg";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface BootedStack {
  databaseUrl: string;
  baseUrl: string;
  authSecret: string;
  ollamaUrl: string;
}

export interface BootResult {
  stack: BootedStack;
  teardown: () => Promise<void>;
}

const APP_ROOT = path.resolve(__dirname, "../..");
const POST_PUSH_SQL = path.join(APP_ROOT, "drizzle", "post-push-init.sql");

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("could not get free port"));
      }
    });
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      // Any non-5xx response means the server is alive (we just need the
      // socket + Next.js stack to be up; the route's auth/etc is irrelevant).
      if (res.status < 500) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${url} never came up: ${String(lastErr)}`);
}

export async function bootStack(): Promise<BootResult> {
  // -------------------------------------------------------------------- DB
  const container = await new PostgreSqlContainer("postgres:18-alpine")
    .withDatabase("hubtest")
    .withUsername("hubtest")
    .withPassword("hubtest")
    .start();

  const databaseUrl = container.getConnectionUri();

  // drizzle-kit push --force is non-interactive and creates everything on a
  // fresh DB. Mirrors the production bootstrap workflow exactly — no separate
  // hand-maintained schema SQL to drift.
  const push = spawnSync(
    "pnpm",
    ["exec", "drizzle-kit", "push", "--force"],
    {
      cwd: APP_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    }
  );
  if (push.status !== 0) {
    await container.stop();
    throw new Error(`drizzle-kit push failed (exit ${push.status})`);
  }

  // post-push-init.sql adds extensions (pg_trgm) and GIN indexes that
  // drizzle-kit push does not synthesize. Applied via a single connection.
  const initSql = fs.readFileSync(POST_PUSH_SQL, "utf-8");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(initSql);
  await client.end();

  // --------------------------------------------------------------- Next.js
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const authSecret = crypto.randomBytes(32).toString("hex");

  // jarvis-ollama is host-mapped at 127.0.0.1:11434 (per docker-compose). The
  // in-network DNS name "jarvis-ollama" only resolves inside the docker net,
  // so for host-spawned processes we hit the loopback mapping.
  const ollamaUrl = process.env.OLLAMA_URL_TEST ?? "http://127.0.0.1:11434";
  const ollamaModel = process.env.OLLAMA_MODEL ?? "qwen3.6:35b";

  // detached: true puts the child in its own process group. Combined with
  // process.kill(-pid, ...) at teardown, this reliably kills the whole tree
  // (pnpm CLI → next CLI → next-server worker) instead of just the top.
  const nextProc = spawn(
    "pnpm",
    ["exec", "next", "dev", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: APP_ROOT,
      detached: true,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        AUTH_SECRET: authSecret,
        OLLAMA_URL: ollamaUrl,
        OLLAMA_MODEL: ollamaModel,
        AI_FEATURES_ENABLED: "false",
        NODE_ENV: "test",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  nextProc.stdout?.on("data", (b) => process.stderr.write(`[next] ${b}`));
  nextProc.stderr?.on("data", (b) => process.stderr.write(`[next!] ${b}`));
  nextProc.on("exit", (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`[next] process exited with code ${code}\n`);
    }
  });

  await waitForHttp(`${baseUrl}/api/sessions`, 120_000);

  const stack: BootedStack = {
    databaseUrl,
    baseUrl,
    authSecret,
    ollamaUrl,
  };

  const teardown = async () => {
    if (nextProc && nextProc.exitCode === null && nextProc.pid !== undefined) {
      try {
        // Negative pid signals the entire process group.
        process.kill(-nextProc.pid, "SIGTERM");
      } catch {
        // Group may have already exited.
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try {
            if (nextProc?.pid !== undefined) {
              process.kill(-nextProc.pid, "SIGKILL");
            }
          } catch {
            // already dead
          }
          resolve();
        }, 5000);
        nextProc?.on("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (container) {
      await container.stop();
    }
  };

  return { stack, teardown };
}
