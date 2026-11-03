import { test, expect } from "@playwright/test";

for (const fullscreen of [false, true]) {
  test(`drops near all four handles work at reduced zoom (${fullscreen ? "fullscreen" : "normal"})`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "avalon-roads:board:v1",
        JSON.stringify({
          version: 1,
          canvasWidth: 1366,
          viewport: { x: 180, y: 70, zoom: 0.45 },
          edges: [],
          nodes: [
            { id: "map-1", mapId: 1, position: { x: 0, y: 0 } },
            { id: "map-2", mapId: 2, position: { x: 500, y: 0 } },
          ],
        }),
      );
    });
    await page.goto("/");
    await expect(page.locator(".road-card")).toHaveCount(2);
    if (fullscreen) {
      await page
        .getByRole("button", { name: "Abrir mapa em tela cheia", exact: true })
        .click();
      await page.waitForTimeout(500);
      for (let index = 0; index < 4; index += 1) {
        await page.locator(".react-flow__controls-zoomout").click();
        await page.waitForTimeout(250);
      }
    }
    await expect
      .poll(() =>
        page.evaluate(() => {
          const transform = document.querySelector(".react-flow__viewport")
            .style.transform;
          return Number(transform.match(/scale\(([^)]+)\)/)[1]);
        }),
      )
      .toBeLessThan(0.6);
    for (const side of ["top", "bottom", "left", "right"]) {
      const start = await page
        .locator('.react-flow__node[data-id="map-1"] .react-flow__handle-top')
        .boundingBox();
      const end = await page
        .locator(
          `.react-flow__node[data-id="map-2"] .react-flow__handle-${side}`,
        )
        .boundingBox();
      await page.mouse.move(
        start.x + start.width / 2,
        start.y + start.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        end.x + end.width / 2,
        end.y + end.height / 2 + 14,
        { steps: 15 },
      );
      await page.mouse.up();
      const dialog = page.getByRole("dialog", { name: "Quanto tempo resta?" });
      await expect(dialog).toBeVisible();
      if (side === "right") {
        await dialog
          .getByRole("button", { name: "Criar conexão", exact: true })
          .click();
        await expect(page.locator(".edge-time")).toHaveCount(1);
        await expect(page.getByRole("status")).toContainText(
          "Conexão adicionada",
        );
      } else {
        await dialog
          .getByRole("button", { name: "Cancelar", exact: true })
          .click();
        await expect(page.locator(".edge-time")).toHaveCount(0);
      }
    }
  });
}
