import { test, expect } from "@playwright/test";

async function dragConnection(page) {
  const source = await page
    .locator('.react-flow__node[data-id="map-1"] .react-flow__handle-right')
    .boundingBox();
  const target = await page
    .locator('.react-flow__node[data-id="map-2"] .react-flow__handle-left')
    .boundingBox();
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 15 },
  );
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("abbreviated search works in the toolbar catalog and both form selectors", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Adicionar mapa pelo catálogo", exact: true })
    .click();
  await page.getByLabel("Buscar no catálogo").fill("ca a");
  await expect
    .poll(() => page.locator(".catalog-item").count())
    .toBeGreaterThan(1);
  await page.getByLabel("Buscar no catálogo").fill("ca ai");
  await page
    .getByRole("button", { name: "Adicionar Casos-Aiagsum", exact: true })
    .click();
  await expect(page.locator(".road-card")).toHaveCount(1);
  await expect(page.locator(".edge-time")).toHaveCount(0);
  await page.getByRole("button", { name: "Fechar catálogo" }).click();
  for (const label of ["De", "Para"]) {
    await page
      .getByRole("combobox", { name: label, exact: true })
      .fill("CA A");
    await expect
      .poll(() => page.getByRole("option").count())
      .toBeGreaterThan(1);
    await page.getByRole("combobox", { name: label, exact: true }).fill("CA AI");
    await page.getByRole("option", { name: /Casos-Aiagsum/ }).click();
    await expect(
      page.getByRole("combobox", { name: label, exact: true }),
    ).toHaveValue("Casos-Aiagsum");
  }
  const small = page.locator(".road-card .feature-small").first();
  const large = page.locator(".road-card .feature-large").first();
  await expect(small).toBeVisible();
  await expect(large).toBeVisible();
  expect(
    await small.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).not.toBe(
    await large.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  );
  await expect(large.locator(".feature-size")).toHaveText("G");
});

test("lateral drag asks for its own duration and preserves handles through reload and edit", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Adicionar mapa pelo catálogo", exact: true })
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
  await expect(
    page.locator('.react-flow__node[data-id="map-1"] .react-flow__handle'),
  ).toHaveCount(4);
  await page.getByLabel("Horas restantes").selectOption("1");
  await page.getByLabel("Minutos restantes").selectOption("5");
  await dragConnection(page);
  const dialog = page.getByRole("dialog", { name: "Quanto tempo resta?" });
  await expect(page.locator(".edge-time")).toHaveCount(0);
  await expect(dialog.getByLabel("Horas", { exact: true })).toHaveValue("6");
  await dialog.getByLabel("Horas", { exact: true }).fill("0");
  await dialog
    .getByRole("button", { name: "Criar conexão", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("maior que zero");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".edge-time")).toHaveCount(0);
  await dragConnection(page);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.locator(".edge-time")).toHaveCount(0);
  await dragConnection(page);
  await dialog.getByLabel("Horas", { exact: true }).fill("2");
  await dialog.getByLabel("Minutos", { exact: true }).fill("35");
  await dialog
    .getByRole("button", { name: "Criar conexão", exact: true })
    .click();
  await expect(page.locator(".edge-time")).toHaveText("2h 35m");
  await expect(page.getByLabel("Horas restantes")).toHaveValue("1");
  await expect(page.getByLabel("Minutos restantes")).toHaveValue("5");
  await expect(
    page.getByText("Salvo neste navegador", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".edge-time")).toHaveText("2h 35m");
  await page.locator(".edge-time").click();
  await page.getByLabel("Horas restantes").selectOption("4");
  await page
    .getByRole("button", { name: "Salvar conexão", exact: true })
    .click();
  await expect(page.locator(".edge-time")).toHaveText("4h 35m");
  await expect(
    page.getByText("Salvo neste navegador", { exact: true }),
  ).toBeVisible();
  const edge = await page.evaluate(
    () => JSON.parse(localStorage.getItem("avalon-roads:board:v1")).edges[0],
  );
  expect(edge.sourceHandle).toBe("right");
  expect(edge.targetHandle).toBe("left");
});
