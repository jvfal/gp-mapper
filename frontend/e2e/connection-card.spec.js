import { test, expect } from "@playwright/test";

for (const mobile of [false, true]) {
  test(`duration card stays next to the target and inside the board (${mobile ? "mobile fullscreen" : "desktop"})`, async ({
    page,
  }) => {
    if (mobile) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(() => {
        Element.prototype.requestFullscreen = () =>
          Promise.reject(new Error("Unsupported"));
      });
    }
    await page.goto("/");
    if (mobile)
      await page
        .getByRole("button", { name: "Abrir mapa em tela cheia", exact: true })
        .click();
    await page
      .getByRole("button", {
        name: "Adicionar mapa pelo catálogo",
        exact: true,
      })
      .click();
    for (const name of ["Cases-Ugumlos", "Casitos-Alieam"]) {
      await page.getByLabel("Buscar no catálogo").fill(name);
      await page
        .getByRole("button", { name: `Adicionar ${name}`, exact: true })
        .click();
    }
    await page.getByRole("button", { name: "Fechar catálogo" }).click();
    await page.getByTitle("Organizar mapas").click();
    await page.waitForTimeout(500);
    const start = await page
      .locator('.react-flow__node[data-id="map-1"] .react-flow__handle-right')
      .boundingBox();
    const end = await page
      .locator('.react-flow__node[data-id="map-2"] .react-flow__handle-left')
      .boundingBox();
    await page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
      steps: 15,
    });
    await page.mouse.up();
    const card = page.getByRole("dialog", { name: "Quanto tempo resta?" });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("aria-modal", "false");
    expect(await page.locator("dialog[open]").count()).toBe(0);
    const bounds = await page.locator(".canvas-area").boundingBox();
    const box = await card.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    if (!mobile) {
      const handleX = end.x + end.width / 2;
      expect(
        Math.min(
          Math.abs(box.x - handleX),
          Math.abs(box.x + box.width - handleX),
        ),
      ).toBeLessThan(40);
    }
    await expect(page.locator(".edge-time")).toHaveCount(0);
    await card.getByLabel("Minutos", { exact: true }).fill("15");
    // The toolbar remains interactive: clicking outside dismisses the draft card.
    await page.getByTitle("Organizar mapas").click();
    await expect(card).not.toBeVisible();
    await expect(page.locator(".edge-time")).toHaveCount(0);
    if (mobile)
      await expect(
        page.getByRole("button", { name: "Sair da tela cheia", exact: true }),
      ).toBeVisible();
  });
}
