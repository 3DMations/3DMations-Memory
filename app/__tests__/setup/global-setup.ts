// Vitest globalSetup. Boots the shared test stack (Postgres testcontainer +
// next dev) and exposes connection details to test files via Vitest's
// provide/inject channel. Setup runs once per `pnpm test` invocation.

import type { TestProject } from "vitest/node";
import { bootStack } from "./boot-stack";

declare module "vitest" {
  export interface ProvidedContext {
    DATABASE_URL: string;
    HUB_BASE_URL: string;
    AUTH_SECRET: string;
    OLLAMA_URL: string;
  }
}

export default async function setup(project: TestProject) {
  const { stack, teardown } = await bootStack();

  project.provide("DATABASE_URL", stack.databaseUrl);
  project.provide("HUB_BASE_URL", stack.baseUrl);
  project.provide("AUTH_SECRET", stack.authSecret);
  project.provide("OLLAMA_URL", stack.ollamaUrl);

  return teardown;
}
