import { test, expect } from "@playwright/test";
import { addMaps } from "./helpers";

for (const mobile of [false, true]) {
  test(`five icons fit one row and six balance into 3-3 (${mobile ? "mobile" : "desktop"})`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".connection-panel")).toHaveCount(0);
    await expect(page.locator(".page-heading .catalog-open")).toHaveCount(0);
    await addMaps(page, ["Casitos-Alieam", "Casos-Aiagsum"]);
    const five = page.locator(
      '.react-flow__node[data-id="map-2"] .feature-row',
    );
    await expect(five).toHaveCount(1);
    await expect(five.locator(".feature-chip")).toHaveCount(5);
    const six = page.locator('.react-flow__node[data-id="map-4"] .feature-row');
    await expect(six).toHaveCount(2);
    for (const row of await six.all())
      await expect(row.locator(".feature-chip")).toHaveCount(3);
    const positions = await five.locator(".feature-chip").evaluateAll((items) =>
      items.map((item) => ({
        top: item.getBoundingClientRect().top,
        right: item.getBoundingClientRect().right,
        rowRight: item.parentElement.getBoundingClientRect().right,
        fits: item.scrollWidth <= item.clientWidth,
      })),
    );
    expect(
      Math.max(...positions.map((item) => item.top)) -
        Math.min(...positions.map((item) => item.top)),
    ).toBeLessThan(1);
    expect(
      positions.every((item) => item.right <= item.rowRight + 1 && item.fits),
    ).toBe(true);
  });
}
