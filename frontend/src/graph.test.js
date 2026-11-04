import test from "node:test";
import assert from "node:assert/strict";
import {
  connectionExists,
  matchesMapName,
  makeNode,
  organizeNodes,
  remainingTime,
  restoreBoard,
  serializeBoard,
} from "./graph.js";

const catalog = [{ id: 1 }, { id: 2 }, { id: 3 }];
const nodes = catalog.map((map, index) =>
  makeNode(map, { x: index * 100, y: 0 }),
);
const edge = {
  id: "a",
  source: "map-1",
  target: "map-2",
  type: "timed",
  data: { expiresAt: 1000 },
};

test("connections are undirected and can exclude the edge being edited", () => {
  assert.equal(connectionExists([edge], "map-2", "map-1"), true);
  assert.equal(connectionExists([edge], "map-2", "map-1", "a"), false);
});

test("map search supports ordered word prefixes, full names and ordinary substrings", () => {
  for (const query of [
    "ca ai",
    "CA AI",
    " ca    ai ",
    "ca-ai",
    "Casos-Aiagsum",
    "casos aiagsum",
    "aiags",
    "",
  ]) {
    assert.equal(matchesMapName("Casos-Aiagsum", query), true, query);
  }
  assert.equal(matchesMapName("Casitos-Aiayum", "ca ai"), true);
  assert.equal(matchesMapName("Casos-Ugumlos", "ca ai"), false);
  assert.equal(matchesMapName("Casos-Aiagsum", "ai ca"), false);
  assert.equal(matchesMapName("Casos-Aiagsum", "ca ai more"), false);
});

test("lateral handles survive saving and restoring a board", () => {
  const saved = serializeBoard(
    nodes,
    [{ ...edge, sourceHandle: "right", targetHandle: "left" }],
    null,
  );
  const restored = restoreBoard(saved, catalog);
  assert.equal(restored.edges[0].sourceHandle, "right");
  assert.equal(restored.edges[0].targetHandle, "left");
});

test("time labels round up the final minute and expose expiration", () => {
  assert.equal(remainingTime(60_001, 0), "1m 01s");
  assert.equal(remainingTime(3_660_000, 0), "1h 01m 00s");
  assert.equal(remainingTime(59_000, 0), "59s");
  assert.equal(remainingTime(1, 0), "1s");
  assert.equal(remainingTime(0, 1), "Expirada");
});

test("a stored board restores map identities and strips transient selection", () => {
  const saved = serializeBoard(
    [{ ...nodes[0], selected: true }, nodes[1]],
    [edge],
    { x: 1, y: 2, zoom: 0.8 },
  );
  const restored = restoreBoard(saved, catalog);
  assert.equal(restored.nodes.length, 2);
  assert.equal(restored.nodes[0].selected, undefined);
  assert.equal(restored.edges[0].data.expiresAt, 1000);
  assert.deepEqual(restored.viewport, { x: 1, y: 2, zoom: 0.8 });
});

test("stale, duplicate and malformed stored items cannot introduce invalid connections", () => {
  const saved = serializeBoard(nodes, [edge], null);
  saved.nodes.push(
    null,
    { id: "wrong", mapId: 100, position: { x: 0, y: 0 } },
    saved.nodes[0],
  );
  saved.edges.push(
    null,
    { ...saved.edges[0], id: "b", source: "map-2", target: "map-1" },
    { ...saved.edges[0], id: "c", target: "missing" },
    { ...saved.edges[0], id: "d", expiresAt: "wrong" },
  );
  const restored = restoreBoard(saved, catalog);
  assert.equal(restored.nodes.length, 3);
  assert.equal(restored.edges.length, 1);
  assert.deepEqual(restored.viewport, { x: 0, y: 0, zoom: 1 });
});

test("cyclic and disconnected graphs get distinct, finite positions", () => {
  const graph = [edge, { source: "map-2", target: "map-1" }];
  const result = organizeNodes(nodes, graph);
  assert.equal(
    new Set(result.map((node) => `${node.position.x}:${node.position.y}`)).size,
    3,
  );
  assert.ok(
    result.every(
      (node) =>
        Number.isFinite(node.position.x) && Number.isFinite(node.position.y),
    ),
  );
});
