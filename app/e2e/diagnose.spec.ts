import { test, expect } from "@playwright/test";

// Capture all console messages and page errors so we can see what
// the browser actually sees vs. what our SSR/curl checks suggested.
function attachListeners(page: import("@playwright/test").Page) {
  const consoleMessages: { type: string; text: string }[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  page.on("pageerror", (err) => {
    pageErrors.push(`${err.name}: ${err.message}`);
  });
  return { consoleMessages, pageErrors };
}

test("home page gear button opens settings menu", async ({ page }) => {
  const { consoleMessages, pageErrors } = attachListeners(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  console.log("\n--- / console messages ---");
  for (const m of consoleMessages) console.log(`[${m.type}] ${m.text}`);
  console.log("\n--- / page errors ---");
  for (const e of pageErrors) console.log(e);

  const gear = page.getByRole("button", { name: "Settings" });
  await expect(gear).toBeVisible();
  await expect(gear).toHaveAttribute("aria-expanded", "false");

  await gear.click();
  await page.waitForTimeout(200);

  await expect(gear).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();

  const lightBtn = page.getByRole("menuitemradio", { name: /Light/ });
  const darkBtn = page.getByRole("menuitemradio", { name: /Dark/ });
  await expect(lightBtn).toBeVisible();
  await expect(darkBtn).toBeVisible();
});

test("/stats page renders KPI tiles + sections", async ({ page }) => {
  await page.goto("/stats", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible();
  await expect(page.getByText("Memories", { exact: true })).toBeVisible();
  await expect(page.getByText("Sessions", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Memories created/ }),
  ).toBeVisible();
});

test("/gotchas page renders both sections", async ({ page }) => {
  await page.goto("/gotchas", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Gotchas" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /High recurrence/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Cross-session lookalikes/i }),
  ).toBeVisible();
});

test("light/dark toggle persists across navigation", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("menuitemradio", { name: /Light/ }).click();

  // Navigate to another page
  await page.goto("/stats");
  // <html> should still have class="light" (set by inline script from localStorage)
  const html = page.locator("html");
  await expect(html).toHaveClass(/light/);

  // Reset for other tests
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("menuitemradio", { name: /Dark/ }).click();
});
