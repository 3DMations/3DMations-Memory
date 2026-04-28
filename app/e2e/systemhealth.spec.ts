import { test, expect } from "@playwright/test";

test("/systemhealth renders heading and chart cards", async ({ page }) => {
  await page.goto("/systemhealth", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();

  // 10 ResponsiveContainer divs (one per metric) — recharts emits this class.
  const containers = page.locator(".recharts-responsive-container");
  await expect(containers).toHaveCount(10);
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
