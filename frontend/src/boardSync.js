// Shared document only. Camera, selection and panels belong to each client.
export function graphDocument(state) {
  const nodes = state.nodes.map((node) => ({
    id: node.id,
    mapId: node.mapId,
    position: { ...node.position },
  }));
  const edges = state.edges.map((edge) => {
    const item = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      expiresAt: edge.expiresAt,
    };
    if (Number(item.source.slice(4)) > Number(item.target.slice(4))) {
      [item.source, item.target] = [item.target, item.source];
      [item.sourceHandle, item.targetHandle] = [
        item.targetHandle,
        item.sourceHandle,
      ];
    }
    return item;
  });
  return {
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function graphDiff(before, after) {
  const oldNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const newNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const oldEdges = new Map(before.edges.map((edge) => [edge.id, edge]));
  const newEdges = new Map(after.edges.map((edge) => [edge.id, edge]));
  const result = [];
  for (const [id] of oldEdges)
    if (!newEdges.has(id)) result.push({ type: "edge.remove", id });
  for (const [id, node] of oldNodes)
    if (!newNodes.has(id))
      result.push({ type: "node.remove", mapId: node.mapId });
  for (const [id, node] of newNodes) {
    const old = oldNodes.get(id);
    if (!old || !equal(old.position, node.position))
      result.push({
        type: old ? "node.move" : "node.add",
        mapId: node.mapId,
        position: node.position,
      });
  }
  for (const [id, edge] of newEdges)
    if (!equal(oldEdges.get(id), edge))
      result.push({
        type: oldEdges.has(id) ? "edge.update" : "edge.add",
        edge,
      });
  return result;
}
export function applyGraphOps(document, operations) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const edges = new Map(document.edges.map((edge) => [edge.id, edge]));
  for (const op of operations) {
    const id = `map-${op.mapId}`;
    if (op.type === "node.add" && !nodes.has(id))
      nodes.set(id, { id, mapId: op.mapId, position: op.position });
    if (op.type === "node.move" && nodes.has(id))
      nodes.set(id, { ...nodes.get(id), position: op.position });
    if (op.type === "node.remove") {
      nodes.delete(id);
      for (const [key, edge] of edges)
        if (edge.source === id || edge.target === id) edges.delete(key);
    }
    if (op.type === "edge.remove") edges.delete(op.id);
    if (op.type === "edge.add" || op.type === "edge.update") {
      const edge = op.edge;
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
      if (
        (op.type === "edge.add" && edges.has(edge.id)) ||
        (op.type === "edge.update" && !edges.has(edge.id))
      )
        continue;
      if (
        [...edges.values()].some(
          (other) =>
            other.id !== edge.id &&
            ((other.source === edge.source && other.target === edge.target) ||
              (other.target === edge.source && other.source === edge.target)),
        )
      )
        continue;
      edges.set(edge.id, edge);
    }
  }
  return graphDocument({
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  });
}

export class BoardSync {
  constructor(board, callbacks) {
    this.callbacks = callbacks;
    this.confirmed = graphDocument(board.state);
    this.rendered = this.confirmed;
    this.revision = board.revision;
    this.canEdit = board.permissions.canEdit;
    this.pending = [];
    this.inflight = null;
    this.waiters = [];
    this.ready = false;
    this.initialized = false;
  }
  dirty() {
    return this.pending.length > 0 || !!this.inflight;
  }
  observe(state) {
    const next = graphDocument(state);
    if (this.initialized && this.canEdit && !this.denied) {
      for (const op of graphDiff(this.rendered, next)) {
        // Collapse drag frames waiting for the next network batch.
        const key =
          op.type === "node.move"
            ? op.mapId
            : op.type === "edge.update"
              ? op.edge.id
              : null;
        let replaced = false;
        if (key !== null)
          for (let i = this.pending.length - 1; i >= 0; i--) {
            const previous = this.pending[i];
            const previousKey = previous.type.startsWith("node.")
              ? previous.mapId
              : (previous.edge?.id ?? previous.id);
            if (previousKey !== key) continue;
            if (previous.type === op.type) {
              this.pending[i] = op;
              replaced = true;
            }
            break;
          }
        if (!replaced) this.pending.push(op);
      }
    }
    this.initialized = true;
    this.rendered = next;
    this.updateStatus();
    this.schedule();
  }
  attach(socket) {
    this.socket = socket;
    this.ready = false;
    this.callbacks.connection(
      this.connectedBefore ? "reconnecting" : "connecting",
    );
    this.updateStatus();
  }
  schedule() {
    if (
      this.timer ||
      !this.ready ||
      this.inflight ||
      !this.pending.length ||
      !this.canEdit ||
      this.denied ||
      this.failed
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sendNext();
    }, 120);
  }
  sendNext() {
    if (
      !this.ready ||
      this.inflight ||
      !this.pending.length ||
      !this.canEdit ||
      this.denied ||
      this.failed
    )
      return;
    this.inflight = {
      type: "mutate",
      mutationId: crypto.randomUUID(),
      operations: this.pending.splice(0, 256),
    };
    this.transmit();
  }
  transmit() {
    if (!this.ready || this.socket?.readyState !== 1 || !this.inflight) return;
    this.socket.send(JSON.stringify(this.inflight));
    clearTimeout(this.ackTimer);
    this.ackTimer = setTimeout(() => this.socket?.close(), 10_000);
  }
  receive(message) {
    if (message.type === "denied") {
      this.denied = true;
      this.updateStatus();
      return;
    }
    if (message.type === "error") {
      this.failed = true;
      clearTimeout(this.ackTimer);
      this.updateStatus();
      return;
    }
    if (message.type !== "snapshot") return;
    const first = !this.ready;
    this.ready = true;
    this.connectedBefore = true;
    this.callbacks.connection("online");
    if (message.ack && message.ack === this.inflight?.mutationId) {
      this.inflight = null;
      clearTimeout(this.ackTimer);
    }
    if (message.board.revision >= this.revision) {
      this.revision = message.board.revision;
      this.confirmed = graphDocument(message.board.state);
      this.canEdit = message.board.permissions.canEdit;
      if (!this.canEdit && this.dirty()) this.denied = true;
      this.callbacks.metadata(message.board);
    }
    const rebased = applyGraphOps(this.confirmed, [
      ...(this.inflight?.operations || []),
      ...this.pending,
    ]);
    if (!equal(this.rendered, rebased)) {
      this.rendered = rebased;
      this.callbacks.apply(rebased);
    }
    if (first && this.inflight && this.canEdit && !this.denied) this.transmit();
    this.updateStatus();
    this.schedule();
  }
  disconnected() {
    this.ready = false;
    clearTimeout(this.ackTimer);
    clearTimeout(this.timer);
    this.timer = null;
    this.callbacks.connection("reconnecting");
    this.updateStatus();
  }
  updateStatus() {
    const status = this.denied
      ? "denied"
      : this.failed
        ? "failed"
        : !this.ready
          ? this.connectedBefore
            ? "reconnecting"
            : "connecting"
          : this.dirty()
            ? "saving"
            : "saved";
    this.callbacks.status(status);
    if (this.denied || this.failed || (!this.ready && this.waiters.length)) {
      for (const waiter of this.waiters.splice(0))
        waiter.reject(new Error(status));
    } else if (!this.dirty()) {
      for (const waiter of this.waiters.splice(0)) waiter.resolve();
    }
  }
  flush() {
    if (!this.dirty()) return Promise.resolve();
    if (!this.ready || this.denied || this.failed)
      return Promise.reject(new Error("not_synced"));
    clearTimeout(this.timer);
    this.timer = null;
    const promise = new Promise((resolve, reject) =>
      this.waiters.push({ resolve, reject }),
    );
    this.sendNext();
    return promise;
  }
  dispose() {
    clearTimeout(this.timer);
    clearTimeout(this.ackTimer);
    this.timer = null;
    this.ready = false;
    for (const waiter of this.waiters.splice(0))
      waiter.reject(new Error("closed"));
  }
}
