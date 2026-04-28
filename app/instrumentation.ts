// Phase 6 — self-monitoring entry point. Next.js calls register() once when
// the server boots. We gate the actual collector to the node runtime so the
// edge worker doesn't double-fire, per
// https://nextjs.org/docs/app/guides/instrumentation
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
