// Per-worker setup: pulls connection info from the globalSetup channel and
// installs it into process.env BEFORE any test file imports `@/db` or
// `@/lib/ollama`, both of which read their URLs synchronously at module
// load time.

import { inject } from "vitest";

process.env.DATABASE_URL = inject("DATABASE_URL");
process.env.HUB_BASE_URL = inject("HUB_BASE_URL");
process.env.AUTH_SECRET = inject("AUTH_SECRET");
process.env.OLLAMA_URL = inject("OLLAMA_URL");
