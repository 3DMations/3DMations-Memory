import { test, expect } from "@playwright/test";

// Smoke E2E covering the dashboard landing page renders with sessions list.
// More flows (create session, delete with both options, search, compare)
// will be added as Phase 4 polish lands. Keeping this minimal until then.

test("landing page renders with Hub heading", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Hub/i);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("orphaned view is reachable", async ({ page }) => {
  await page.goto("/orphaned");
  // Page renders a heading even when empty
  await expect(page.getByRole("heading")).toBeVisible();
});

test("search page accepts query input", async ({ page }) => {
  await page.goto("/search");
  const input = page.getByRole("searchbox").or(page.getByRole("textbox")).first();
  await expect(input).toBeVisible();
});
