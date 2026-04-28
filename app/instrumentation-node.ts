// Phase 6 — system metric collector wiring. Side-effect import: schedules a
// 5-minute interval that calls collectAndPersist(). Loaded only when
// NEXT_RUNTIME === 'nodejs' (see instrumentation.ts).

import {
  collectAndPersist,
  COLLECT_INTERVAL_MS,
  LOG_PREFIX,
} from "@/lib/system-metrics";

// Fire once at boot so /systemhealth has data on first load.
collectAndPersist().catch((e) =>
  console.error(LOG_PREFIX, "initial collect failed", e),
);

// Then every 5 minutes for as long as the process lives.
setInterval(() => {
  collectAndPersist().catch((e) =>
    console.error(LOG_PREFIX, "tick failed", e),
  );
}, COLLECT_INTERVAL_MS);

console.log(LOG_PREFIX, `collector started — interval ${COLLECT_INTERVAL_MS}ms`);
