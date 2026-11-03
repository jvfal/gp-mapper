import { test, expect } from "@playwright/test";

async function addMap(page, name) {
  await page
    .getByRole("button", { name: "Adicionar mapa pelo catálogo", exact: true })
    .click();
  await page.getByLabel("Buscar no catálogo").fill(name);
  await page
    .getByRole("button", { name: `Adicionar ${name}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Fechar catálogo" }).click();
}

test("native fullscreen keeps the catalog, connections, time editing and toolbar usable", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Abrir mapa em tela cheia", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.fullscreenElement?.classList.contains("canvas-shell"),
      ),
    )
    .toBe(true);
  const board = page.getByRole("region", { name: "Editor de conexões" });
  await expect(board).toHaveClass(/is-fullscreen/);
  const bounds = await board.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds.x).toBe(0);
  expect(bounds.y).toBe(0);
  expect(bounds.height).toBe(viewport.height);
  await addMap(page, "Cases-Ugumlos");
  await addMap(page, "Casitos-Alieam");
  await page.getByTitle("Organizar mapas").click();
  await page.waitForTimeout(500);
  const from = await page
    .locator('.react-flow__node[data-id="map-1"] .react-flow__handle-right')
    .boundingBox();
  const to = await page
    .locator('.react-flow__node[data-id="map-2"] .react-flow__handle-left')
    .boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
  let dialog = board.getByRole("dialog", { name: "Quanto tempo resta?" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Horas", { exact: true }).fill("2");
  await dialog
    .getByRole("button", { name: "Criar conexão", exact: true })
    .click();
  await expect(page.locator(".edge-time")).toHaveText("2h 00m");
  await page.locator(".edge-time").click();
  dialog = board.getByRole("dialog", { name: "Editar conexão", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Horas", { exact: true }).fill("3");
  await dialog
    .getByRole("button", { name: "Salvar conexão", exact: true })
    .click();
  await expect(page.locator(".edge-time")).toHaveCount(1);
  await expect(page.locator(".edge-time")).toHaveText("3h 00m");
  await expect(board.getByRole("status")).toContainText("Conexão atualizada");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar imagem do mapa" }).click();
  expect((await download).suggestedFilename()).toBe("avalon-roads.png");
  await page.getByRole("button", { name: "Remover seleção" }).click();
  await expect(page.locator(".edge-time")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Sair da tela cheia", exact: true })
    .click();
  await expect(board).not.toHaveClass(/is-fullscreen/);
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);
  await expect(page.locator(".road-card")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("mobile focus fallback keeps maps editable and exits with Escape", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () =>
      Promise.reject(new Error("Unsupported"));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Abrir mapa em tela cheia", exact: true })
    .click();
  const board = page.getByRole("region", { name: "Editor de conexões" });
  await expect(board).toHaveClass(/is-fullscreen/);
  await addMap(page, "Cases-Ugumlos");
  await expect(page.locator(".road-card")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(board).not.toHaveClass(/is-fullscreen/);
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("");
  await expect(page.locator(".road-card")).toHaveCount(1);
});

test("browser-driven fullscreen exit updates the toolbar", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Abrir mapa em tela cheia", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sair da tela cheia", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.exitFullscreen());
  await expect(
    page.getByRole("button", { name: "Abrir mapa em tela cheia", exact: true }),
  ).toBeVisible();
});
