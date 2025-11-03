import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = (window as any).__TAURI_INTERNALS__ ?? {};
    (window as any).__TAURI_METADATA__ = (window as any).__TAURI_METADATA__ ?? {};
    window.localStorage?.removeItem("seeded-v2");
  });
});

test("library navigation smoke", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  const firstCard = page.getByRole("button", { name: /toggle details/i }).first();
  if (await firstCard.count()) {
    await firstCard.click();
    await expect(page.getByRole("button", { name: /fetch opencritic/i })).toBeVisible();
  }

  await page.getByRole("link", { name: "Explore", exact: true }).click();
  await expect(page.getByText("Trending")).toBeVisible();

  await page.getByRole("link", { name: "Deals" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /deals/i })).toBeVisible();

  await page.getByRole("link", { name: "Suggestions" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "AI Suggestions" })).toBeVisible();
  await expect(page.getByRole("button", { name: /ask ai/i })).toBeEnabled();
});
