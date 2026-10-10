import { test, expect } from "@playwright/test";

test("/systemhealth renders heading and chart cards", async ({ page }) => {
  await page.goto("/systemhealth", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();

  // recharts emits one .recharts-responsive-container per metric that has data.
  // Inside a container the collector emits all 10 metrics; on a bare host the
  // 2 cgroup-v2 metrics are skipped (memory.current is not at the cgroup root
  // for the test process), so only 8 charts render. Either is correct — the
  // test verifies "the page renders charts for whatever was collected".
  const containers = page.locator(".recharts-responsive-container");
  const count = await containers.count();
  expect(count).toBeGreaterThanOrEqual(8);
  expect(count).toBeLessThanOrEqual(10);
});

test("/systemhealth info-icon popover opens and dismisses", async ({ page }) => {
  await page.goto("/systemhealth", { waitUntil: "networkidle" });

  // Click the first info icon. Hover would also open it; click is more reliable.
  const infoButtons = page.getByRole("button", { name: "About this metric" });
  await expect(infoButtons.first()).toBeVisible();
  await infoButtons.first().click();

  // The tooltip role becomes visible with What/Source/Why fields.
  const tooltip = page.getByRole("tooltip").first();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("What:");
  await expect(tooltip).toContainText("Source:");
  await expect(tooltip).toContainText("Why:");

  // Pressing Escape dismisses.
  await page.keyboard.press("Escape");
  await expect(tooltip).not.toBeVisible();
});
