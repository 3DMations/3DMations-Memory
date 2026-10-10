// Pairs with e2e/global-setup.ts. Playwright invokes this once after all
// specs finish, regardless of test outcome.

interface TeardownHolder {
  __HUB_TEARDOWN__?: () => Promise<void>;
}

export default async function globalTeardown(): Promise<void> {
  const holder = globalThis as unknown as TeardownHolder;
  if (holder.__HUB_TEARDOWN__) {
    await holder.__HUB_TEARDOWN__();
    holder.__HUB_TEARDOWN__ = undefined;
  }
}
