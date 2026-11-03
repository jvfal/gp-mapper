export const STORAGE_KEY = "avalon-roads:board:v1";
export const nodeId = (mapId) => `map-${mapId}`;
export const HANDLE_IDS = ["top", "bottom", "left", "right"];
export const HANDLE_SIZE = 24;

export function featureRows(features) {
  const count = Math.ceil(features.length / 5);
  if (!count) return [];
  const base = Math.floor(features.length / count);
  const remainder = features.length % count;
  return Array.from({ length: count }, (_, index) => {
    const start = index * base + Math.min(index, remainder);
    return features.slice(start, start + base + (index < remainder ? 1 : 0));
  });
}

export function matchesMapName(name, query) {
  const normalize = (value) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .trim();
  const fullName = normalize(name);
  const search = normalize(query);
  if (!search || fullName.includes(search)) return true;
  const parts = fullName.split(/[\s-]+/);
  const tokens = search.split(/[\s-]+/).filter(Boolean);
  return tokens.every((token, index) => parts[index]?.startsWith(token));
}

export function makeNode(map, position) {
  return {
    id: nodeId(map.id),
    type: "roadMap",
    position,
    data: { mapId: map.id },
  };
}

export function connectionExists(edges, source, target, exceptId = null) {
  return edges.some(
    (edge) =>
      edge.id !== exceptId &&
      ((edge.source === source && edge.target === target) ||
        (edge.source === target && edge.target === source)),
  );
}

export function remainingTime(expiresAt, now = Date.now(), expiredLabel = "Expirada") {
  const minutes = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  if (!minutes) return expiredLabel;
  const hours = Math.floor(minutes / 60);
  return hours
    ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
    : `${minutes}m`;
}

export function serializeBoard(nodes, edges, viewport, canvasWidth) {
  return {
    version: 1,
    nodes: nodes.map(({ id, data, position }) => ({
      id,
      mapId: data.mapId,
      position,
    })),
    edges: edges.map(
      ({ id, source, target, sourceHandle, targetHandle, data }) => ({
        id,
        source,
        target,
        sourceHandle,
        targetHandle,
        expiresAt: data.expiresAt,
      }),
    ),
    viewport,
    canvasWidth,
  };
}

export function restoreBoard(saved, catalog) {
  if (
    saved.version !== 1 ||
    !Array.isArray(saved.nodes) ||
    !Array.isArray(saved.edges)
  ) {
    throw new Error("Formato de rascunho inválido.");
  }
  const nodes = [];
  const ids = new Set();
  for (const item of saved.nodes) {
    if (!item || typeof item !== "object") continue;
    const map = catalog.find((entry) => entry.id === item.mapId);
    if (!map || ids.has(nodeId(map.id))) continue;
    if (
      !Number.isFinite(item.position?.x) ||
      !Number.isFinite(item.position?.y)
    )
      continue;
    ids.add(nodeId(map.id));
    nodes.push(makeNode(map, { x: item.position.x, y: item.position.y }));
  }
  const edges = [];
  const edgeIds = new Set();
  for (const item of saved.edges) {
    if (!item || typeof item !== "object") continue;
    if (
      typeof item.id !== "string" ||
      edgeIds.has(item.id) ||
      !ids.has(item.source) ||
      !ids.has(item.target) ||
      item.source === item.target ||
      !Number.isFinite(item.expiresAt) ||
      connectionExists(edges, item.source, item.target)
    )
      continue;
    edgeIds.add(item.id);
    edges.push({
      id: item.id,
      source: item.source,
      target: item.target,
      type: "timed",
      sourceHandle: HANDLE_IDS.includes(item.sourceHandle)
        ? item.sourceHandle
        : "bottom",
      targetHandle: HANDLE_IDS.includes(item.targetHandle)
        ? item.targetHandle
        : "top",
      data: { expiresAt: item.expiresAt },
    });
  }
  const viewport = saved.viewport;
  const validViewport =
    Number.isFinite(viewport?.x) &&
    Number.isFinite(viewport?.y) &&
    Number.isFinite(viewport?.zoom) &&
    viewport.zoom >= 0.25 &&
    viewport.zoom <= 1.8;
  return {
    nodes,
    edges,
    viewport: validViewport ? viewport : { x: 0, y: 0, zoom: 1 },
  };
}

// Breadth-first layout handles undirected connections, cycles and disconnected maps.
export function organizeNodes(nodes, edges) {
  const adjacent = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!adjacent.has(edge.source) || !adjacent.has(edge.target)) continue;
    adjacent.get(edge.source)?.push(edge.target);
    adjacent.get(edge.target)?.push(edge.source);
  }
  const positions = new Map();
  let offset = 0;
  for (const root of nodes) {
    if (positions.has(root.id)) continue;
    const levels = new Map();
    const queue = [{ id: root.id, level: 0 }];
    const visited = new Set([root.id]);
    for (let i = 0; i < queue.length; i += 1) {
      const { id, level } = queue[i];
      if (!levels.has(level)) levels.set(level, []);
      levels.get(level).push(id);
      for (const neighbor of adjacent.get(id) || []) {
        if (visited.has(neighbor) || positions.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push({ id: neighbor, level: level + 1 });
      }
    }
    const width =
      Math.max(...[...levels.values()].map((row) => row.length)) * 310;
    for (const [level, row] of levels) {
      row.forEach((id, index) =>
        positions.set(id, {
          x: offset + (width - row.length * 310) / 2 + index * 310,
          y: level * 225,
        }),
      );
    }
    offset += width + 100;
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) }));
}
