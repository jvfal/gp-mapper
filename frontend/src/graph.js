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
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  if (!seconds) return expiredLabel;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m ${remainder}s`;
  return minutes ? `${minutes}m ${remainder}s` : `${seconds}s`;
}

export function serializeBoard(nodes, edges, viewport, canvasWidth) {
  return {
    version: 1,
    nodes: nodes.map(({ id, data, position }) => ({
      id,
      mapId: data.mapId,
      isHome: !!data.isHome,
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
    const node = makeNode(map, { x: item.position.x, y: item.position.y });
    node.data.isHome = !!item.isHome;
    nodes.push(node);
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

function nodeSize(node) {
  return { width: node.measured?.width || node.width || 252,
    height: node.measured?.height || node.height || 125 };
}

// Keep the northernmost map as the entry point. Space whole branches rather than
// individual rows, so a parent stays over its children and tall cards cannot overlap.
export function organizeNodes(nodes, edges) {
  if (!nodes.length) return nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const compare = (a, b) => byId.get(a).position.x - byId.get(b).position.x ||
    byId.get(a).position.y - byId.get(b).position.y || a.localeCompare(b);
  const adjacent = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!adjacent.has(edge.source) || !adjacent.has(edge.target)) continue;
    adjacent.get(edge.source)?.push(edge.target);
    adjacent.get(edge.target)?.push(edge.source);
  }
  const positions = new Map();
  let offset = 0;
  const roots = [...nodes].sort((a, b) => a.position.y - b.position.y || compare(a.id, b.id));
  for (const root of roots) {
    if (positions.has(root.id)) continue;
    const levels = new Map();
    const queue = [{ id: root.id, level: 0 }];
    const visited = new Set([root.id]);
    const children = new Map();
    for (let i = 0; i < queue.length; i += 1) {
      const { id, level } = queue[i];
      if (!levels.has(level)) levels.set(level, []);
      levels.get(level).push(id);
      children.set(id, []);
      for (const neighbor of [...(adjacent.get(id) || [])].sort(compare)) {
        if (visited.has(neighbor) || positions.has(neighbor)) continue;
        visited.add(neighbor);
        children.get(id).push(neighbor);
        queue.push({ id: neighbor, level: level + 1 });
      }
    }
    const widths = new Map();
    for (const { id } of [...queue].reverse()) {
      const branch = children.get(id);
      widths.set(id, Math.max(nodeSize(byId.get(id)).width,
        branch.reduce((sum, child) => sum + widths.get(child), 0) + Math.max(0, branch.length - 1) * 110));
    }
    const tops = [0];
    for (const [level, row] of levels) {
      tops[level + 1] = tops[level] + Math.max(...row.map((id) => nodeSize(byId.get(id)).height)) + 160;
    }
    const lefts = new Map([[root.id, offset]]);
    for (const { id, level } of queue) {
      const width = widths.get(id), left = lefts.get(id);
      positions.set(id, { x: left + (width - nodeSize(byId.get(id)).width) / 2, y: tops[level] });
      const branch = children.get(id);
      const total = branch.reduce((sum, child) => sum + widths.get(child), 0) + Math.max(0, branch.length - 1) * 110;
      let childLeft = left + (width - total) / 2;
      for (const child of branch) {
        lefts.set(child, childLeft);
        childLeft += widths.get(child) + 110;
      }
    }
    offset += widths.get(root.id) + 200;
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) }));
}

export function alignEdgeHandles(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    if (!source || !target) return edge;
    const a = nodeSize(source), b = nodeSize(target);
    const dx = target.position.x + b.width / 2 - source.position.x - a.width / 2;
    const dy = target.position.y + b.height / 2 - source.position.y - a.height / 2;
    const horizontal = Math.abs(dy) < (a.height + b.height) / 2;
    return { ...edge,
      sourceHandle: horizontal ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top'),
      targetHandle: horizontal ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom'),
    };
  });
}
