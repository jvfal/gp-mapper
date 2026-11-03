import { test, expect } from "@playwright/test";

test("drag handles to connect maps and drag a card to save its position", async ({
  page,
}) => {
  await page.goto("/");
  for (const [label, name] of [
    ["De", "Cases-Ugumlos"],
    ["Para", "Casitos-Alieam"],
  ]) {
    await page.getByRole("combobox", { name: label, exact: true }).fill(name);
    await page.getByRole("option", { name: new RegExp(name) }).click();
  }
  await page
    .getByRole("button", { name: "Criar conexão", exact: true })
    .click();
  await expect(page.locator(".edge-time")).toHaveCount(1);
  await page.locator(".edge-time").click();
  await page.getByRole("button", { name: "Remover seleção" }).click();
  await expect(page.locator(".edge-time")).toHaveCount(0);
  const source = page.locator(
    '.react-flow__node[data-id="map-1"] .react-flow__handle-bottom',
  );
  const target = page.locator(
    '.react-flow__node[data-id="map-2"] .react-flow__handle-top',
  );
  await page.waitForTimeout(500);
  const from = await source.boundingBox(),
    to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 15,
  });
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "Quanto tempo resta?" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".edge-time")).toHaveCount(0);
  await dialog.getByLabel("Horas", { exact: true }).fill("3");
  await dialog.getByLabel("Minutos", { exact: true }).fill("20");
  await dialog
    .getByRole("button", { name: "Criar conexão", exact: true })
    .click();
  await expect(page.locator(".edge-time")).toHaveCount(1);
  await expect(page.locator(".edge-time")).toHaveText("3h 20m");
  await expect(
    page.getByText("Salvo neste navegador", { exact: true }),
  ).toBeVisible();
  const original = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("avalon-roads:board:v1")).nodes.find(
        (node) => node.id === "map-1",
      ).position,
  );
  const heading = page.locator('.react-flow__node[data-id="map-1"] h3');
  const box = await heading.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 35, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("avalon-roads:board:v1")).nodes.find(
            (node) => node.id === "map-1",
          ).position.x,
      ),
    )
    .not.toBe(original.x);
});
