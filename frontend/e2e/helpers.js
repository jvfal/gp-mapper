import { expect } from "@playwright/test";

export async function addMaps(
  page,
  names = ["Cases-Ugumlos", "Casitos-Alieam"],
) {
  await page
    .getByRole("button", { name: "Adicionar mapa pelo catálogo", exact: true })
    .click();
  for (const name of names) {
    await page.getByLabel("Buscar no catálogo").fill(name);
    await page
      .getByRole("button", { name: `Adicionar ${name}`, exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Fechar catálogo" }).click();
  await page.getByTitle("Organizar mapas").click();
  await page.waitForTimeout(500);
}

export async function dragHandles(
  page,
  source = "map-1",
  target = "map-2",
  sourceSide = "bottom",
  targetSide = "top",
) {
  const a = await page
    .locator(
      `.react-flow__node[data-id="${source}"] .react-flow__handle-${sourceSide}`,
    )
    .boundingBox();
  const b = await page
    .locator(
      `.react-flow__node[data-id="${target}"] .react-flow__handle-${targetSide}`,
    )
    .boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
}

export async function createConnection(page) {
  await addMaps(page);
  await dragHandles(page);
  const card = page.getByRole("dialog", { name: "Quanto tempo resta?" });
  await expect(card).toBeVisible();
  await card
    .getByRole("button", { name: "Criar conexão", exact: true })
    .click();
  await expect(page.locator(".edge-time")).toHaveCount(1);
}
