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

test("home page menu button opens settings menu", async ({ page }) => {
  const { consoleMessages, pageErrors } = attachListeners(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  console.log("\n--- / console messages ---");
  for (const m of consoleMessages) console.log(`[${m.type}] ${m.text}`);
  console.log("\n--- / page errors ---");
  for (const e of pageErrors) console.log(e);

  const menuBtn = page.getByRole("button", { name: "Menu" });
  await expect(menuBtn).toBeVisible();
  await expect(menuBtn).toHaveAttribute("aria-expanded", "false");

  await menuBtn.click();
  await page.waitForTimeout(200);

  await expect(menuBtn).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();

  // Theme is a single switch (aria-label flips between "Switch to light/dark mode")
  // and there are menuitem nav links inside the popup.
  const themeSwitch = page.getByRole("switch");
  await expect(themeSwitch).toBeVisible();
  const navLinks = page.getByRole("menuitem");
  await expect(navLinks.first()).toBeVisible();
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
  await page.getByRole("button", { name: "Menu" }).click();
  // Default theme is dark; the switch's aria-label reads "Switch to light mode" while dark.
  await page.getByRole("switch", { name: /switch to light/i }).click();

  // Navigate to another page
  await page.goto("/stats");
  // <html> should still have class="light" (set by inline script from localStorage)
  const html = page.locator("html");
  await expect(html).toHaveClass(/light/);

  // Reset for other tests — switch now reads "Switch to dark mode"
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("switch", { name: /switch to dark/i }).click();
});
