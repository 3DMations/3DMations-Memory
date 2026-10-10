// Playwright globalSetup. Boots the same Postgres testcontainer + next dev
// stack used by Vitest, then exposes the URL to specs via the standard
// PLAYWRIGHT_BASE_URL env var (which playwright.config.ts reads as `baseURL`).
//
// State for the matching globalTeardown is parked on globalThis — Playwright
// runs setup and teardown in the same Node process, so this is reliable.

import type { FullConfig } from "@playwright/test";
import { bootStack } from "../__tests__/setup/boot-stack";

interface TeardownHolder {
  __HUB_TEARDOWN__?: () => Promise<void>;
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const { stack, teardown } = await bootStack();

  process.env.PLAYWRIGHT_BASE_URL = stack.baseUrl;

  (globalThis as unknown as TeardownHolder).__HUB_TEARDOWN__ = teardown;
}
