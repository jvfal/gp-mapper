import { test, expect } from "@playwright/test";

async function selectMap(page, label, name) {
  const input = page.getByRole("combobox", { name: label, exact: true });
  await input.fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).click();
}

async function createConnection(
  page,
  from = "Cases-Ugumlos",
  to = "Casitos-Alieam",
) {
  await selectMap(page, "De", from);
  await selectMap(page, "Para", to);
  await page
    .getByRole("button", { name: "Criar conexão", exact: true })
    .click();
  await expect(page.locator(".road-card")).toHaveCount(2);
  await expect(page.locator(".edge-time")).toHaveCount(1);
}

test("create, inspect, edit, persist, export and remove a connection", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Mapa de conexões." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Escolher primeiro mapa" }),
  ).toBeVisible();
  await createConnection(page);
  const first = page.locator(".road-card").filter({ hasText: "Cases-Ugumlos" });
  await expect(first.locator(".feature-chip")).not.toHaveCount(0);
  await expect
    .poll(() =>
      first
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => image.complete && image.naturalWidth > 0),
        ),
    )
    .toBeTruthy();
  await first.click();
  await expect(
    page.getByRole("complementary", { name: "Detalhes de Cases-Ugumlos" }),
  ).toBeVisible();
  await expect(page.getByAltText("Mapa de Cases-Ugumlos")).toBeVisible();
  await page.getByRole("button", { name: "Fechar detalhes" }).click();
  await page.locator(".edge-time").click();
  await expect(
    page.getByRole("heading", { name: "Editar conexão", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Horas restantes").selectOption("2");
  await page.getByLabel("Minutos restantes").selectOption("15");
  await page.getByRole("button", { name: "Salvar conexão" }).click();
  await expect(page.locator(".edge-time")).toHaveText("2h 15m");
  await expect(
    page.getByText("Salvo neste navegador", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".road-card")).toHaveCount(2);
  await expect(page.locator(".edge-time")).toHaveText("2h 15m");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar quadro" }).click();
  expect((await download).suggestedFilename()).toBe("avalon-roads.json");
  await page.locator(".edge-time").click();
  await page.getByRole("button", { name: "Remover seleção" }).click();
  await expect(page.locator(".edge-time")).toHaveCount(0);
  await expect(page.locator(".road-card")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("reject duplicates and self-connections without adding graph elements", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Escolher primeiro mapa" }),
  ).toBeVisible();
  await createConnection(page);
  await page.getByRole("button", { name: "Inverter origem e destino" }).click();
  await page
    .getByRole("button", { name: "Criar conexão", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Essa conexão já existe",
  );
  await expect(page.locator(".edge-time")).toHaveCount(1);
  await selectMap(page, "De", "Cases-Ugumlos");
  await selectMap(page, "Para", "Cases-Ugumlos");
  await page
    .getByRole("button", { name: "Criar conexão", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Escolha dois mapas diferentes",
  );
});

test("catalog filtering, single-map add, organization and clear work on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Escolher primeiro mapa" }).click();
  await page.getByRole("button", { name: "Tier 4", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Buscar no catálogo" })
    .fill("Casitos-Alieam");
  await page
    .getByRole("button", { name: "Adicionar Casitos-Alieam", exact: true })
    .click();
  await page.getByRole("button", { name: "Fechar catálogo" }).click();
  await expect(page.locator(".road-card")).toHaveCount(1);
  await page.getByTitle("Organizar mapas").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Limpar quadro" }).click();
  await expect(page.locator(".road-card")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Escolher primeiro mapa" }),
  ).toBeVisible();
});

test("catalog failures can be retried", async ({ page }) => {
  await page.route("**/api/catalog/maps/", (route) =>
    route.fulfill({ status: 503, body: "{}" }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Não foi possível carregar os mapas." }),
  ).toBeVisible();
  await page.unroute("**/api/catalog/maps/");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByRole("button", { name: "Escolher primeiro mapa" }),
  ).toBeVisible();
});
