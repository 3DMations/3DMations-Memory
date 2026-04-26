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

test("test page hydrates and click handlers fire", async ({ page }) => {
  const { consoleMessages, pageErrors } = attachListeners(page);
  await page.goto("/test", { waitUntil: "networkidle" });

  await page.waitForTimeout(500); // give hydration a beat

  console.log("\n--- /test console messages ---");
  for (const m of consoleMessages) console.log(`[${m.type}] ${m.text}`);
  console.log("\n--- /test page errors ---");
  for (const e of pageErrors) console.log(e);

  // Click "Clicked N times" button
  const counterBtn = page.locator("button", { hasText: /Clicked/ });
  await counterBtn.click();
  await counterBtn.click();
  await counterBtn.click();
  await expect(counterBtn).toHaveText("Clicked 3 times");

  // Click "Show message" button
  const showBtn = page.locator("button", { hasText: /Show message/ });
  await showBtn.click();
  await expect(page.getByText(/React state works/)).toBeVisible();
});

test("home page gear button opens settings menu", async ({ page }) => {
  const { consoleMessages, pageErrors } = attachListeners(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  console.log("\n--- / console messages ---");
  for (const m of consoleMessages) console.log(`[${m.type}] ${m.text}`);
  console.log("\n--- / page errors ---");
  for (const e of pageErrors) console.log(e);

  // Confirm gear button is visible
  const gear = page.getByRole("button", { name: "Settings" });
  await expect(gear).toBeVisible();

  // Confirm aria-expanded starts false
  await expect(gear).toHaveAttribute("aria-expanded", "false");

  // Click it
  await gear.click();
  await page.waitForTimeout(200);

  // After click, aria-expanded should be true
  await expect(gear).toHaveAttribute("aria-expanded", "true");

  // Menu should appear
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();

  // Theme toggles should be present
  const lightBtn = page.getByRole("menuitemradio", { name: /Light/ });
  const darkBtn = page.getByRole("menuitemradio", { name: /Dark/ });
  await expect(lightBtn).toBeVisible();
  await expect(darkBtn).toBeVisible();
});
