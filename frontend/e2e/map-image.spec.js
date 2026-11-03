import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createConnection } from "./helpers";

test("download and copy generate complete PNGs including offscreen maps without moving the viewport", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "avalon-roads:board:v1",
      JSON.stringify({
        version: 1,
        canvasWidth: 1366,
        viewport: { x: 600, y: 70, zoom: 1 },
        nodes: [
          { id: "map-1", mapId: 1, position: { x: -400, y: 0 } },
          { id: "map-2", mapId: 2, position: { x: 2200, y: 450 } },
        ],
        edges: [
          {
            id: "connection",
            source: "map-1",
            target: "map-2",
            sourceHandle: "left",
            targetHandle: "left",
            expiresAt: Date.now() + 21_600_000,
          },
        ],
      }),
    );
    Object.defineProperty(navigator.clipboard, "write", {
      configurable: true,
      value: async (items) => {
        const blob = await items[0].getType("image/png");
        window.__copiedPng = {
          type: blob.type,
          size: blob.size,
          signature: Array.from(
            new Uint8Array(await blob.arrayBuffer()).slice(0, 8),
          ),
        };
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".road-card")).toHaveCount(2);
  const offscreen = await page
    .locator('.react-flow__node[data-id="map-2"]')
    .boundingBox();
  expect(offscreen.x).toBeGreaterThan(page.viewportSize().width);
  const transform = await page
    .locator(".react-flow__viewport")
    .getAttribute("style");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar imagem do mapa", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("avalon-roads.png");
  const path = testInfo.outputPath("complete-map.png");
  await download.saveAs(path);
  const png = await readFile(path);
  expect(Array.from(png.subarray(0, 8))).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  expect(png.readUInt32BE(16)).toBeGreaterThan(2500);
  const image = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = 0,
      right = 0;
    for (let y = 0; y < canvas.height; y += 4) {
      for (let x = 0; x < canvas.width; x += 4) {
        const index = (y * canvas.width + x) * 4;
        if (
          pixels[index] > 220 &&
          pixels[index + 1] > 220 &&
          pixels[index + 2] > 220
        ) {
          if (x < canvas.width / 3) left += 1;
          if (x > (canvas.width * 2) / 3) right += 1;
        }
      }
    }
    return { left, right };
  }, png.toString("base64"));
  expect(image.left).toBeGreaterThan(100);
  expect(image.right).toBeGreaterThan(100);
  await page
    .getByRole("button", { name: "Copiar imagem do mapa", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Imagem completa do mapa copiada",
  );
  const copied = await page.evaluate(() => window.__copiedPng);
  expect(copied.type).toBe("image/png");
  expect(copied.size).toBeGreaterThan(1000);
  expect(copied.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(
    await page.locator(".react-flow__viewport").getAttribute("style"),
  ).toBe(transform);
});

test("double-clicking the connection line edits its time without adding an edge", async ({
  page,
}) => {
  await page.goto("/");
  await createConnection(page);
  await expect(
    page.getByText("Salvo neste navegador", { exact: true }),
  ).toBeVisible();
  const id = await page.evaluate(
    () => JSON.parse(localStorage.getItem("avalon-roads:board:v1")).edges[0].id,
  );
  const point = await page
    .locator(".react-flow__edge-path")
    .evaluate((path) => {
      for (const fraction of [0.4, 0.6, 0.25, 0.75, 0.15, 0.85]) {
        const point = path.getPointAtLength(path.getTotalLength() * fraction);
        const screen = new DOMPoint(point.x, point.y).matrixTransform(
          path.getScreenCTM(),
        );
        if (
          document
            .elementFromPoint(screen.x, screen.y)
            ?.closest(".react-flow__edge")
        ) {
          return { x: screen.x, y: screen.y };
        }
      }
      throw new Error("No visible edge segment to click");
    });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".connection-card")).toHaveCount(0);
  await page.mouse.dblclick(point.x, point.y);
  const card = page.getByRole("dialog", {
    name: "Editar conexão",
    exact: true,
  });
  await expect(card).toBeVisible();
  await card.getByLabel("Horas", { exact: true }).fill("1");
  await card.getByLabel("Minutos", { exact: true }).fill("10");
  await card
    .getByRole("button", { name: "Salvar conexão", exact: true })
    .click();
  await expect(page.locator(".edge-time")).toHaveCount(1);
  await expect(page.locator(".edge-time")).toHaveText("1h 10m");
  await expect(
    page.getByText("Salvo neste navegador", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("avalon-roads:board:v1")).edges[0].id,
    ),
  ).toBe(id);
});

test("clipboard rejection shows feedback and releases the capture controls", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator.clipboard, "write", {
      configurable: true,
      value: () =>
        Promise.reject(new DOMException("Denied", "NotAllowedError")),
    }),
  );
  await page.goto("/");
  await createConnection(page);
  await page
    .getByRole("button", { name: "Copiar imagem do mapa", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Não foi possível copiar a imagem",
  );
  await expect(
    page.getByRole("button", { name: "Baixar imagem do mapa", exact: true }),
  ).toBeEnabled();
});
