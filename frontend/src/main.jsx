import { useTranslation } from "react-i18next";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { BoardAccessPanel } from "./BoardAccessPanel";
import { DeleteBoardDialog } from "./DeleteBoardDialog";
import { AccountMenu, DiscordStatus } from "./AccountMenu";
import { Brand, guildName } from "./Brand";
import { BoardLibrary, BoardName } from "./BoardLibrary";
import { FirstVisitLanguage } from "./FirstVisitLanguage";
import { useBoardRealtime } from "./useBoardRealtime";
import { Icon } from "./icons";
import { MapSelect } from "./MapSelect";
import { SHOW_CONNECTION_FORM } from "./config";
import { captureMap } from "./captureMap";
import { ConnectionCard } from "./ConnectionCard";
import { useMapFullscreen } from "./useMapFullscreen";
import { AuditContext, CatalogContext, EdgeContext, MapNode, TimedEdge } from "./MapElements";
import { CatalogDrawer, MapInspector } from "./MapDrawer";
import {
  alignEdgeHandles,
  connectionExists,
  makeNode,
  nodeId,
  organizeNodes,
  restoreBoard,
  serializeBoard,
} from "./graph";
const nodeTypes = {
  roadMap: MapNode,
};
const edgeTypes = {
  timed: TimedEdge,
};
const initialViewport = {
  x: 0,
  y: 0,
  zoom: 1,
};
function App({ board, user, onBack, onReload, iconUrl }) {
  const { t } = useTranslation("mapper");
  const [boardMetadata, setBoardMetadata] = useState(board);
  const audits = useMemo(() => ({
    nodes: new Map((boardMetadata.state?.nodes || []).map((node) => [node.mapId, node.audit])),
    edges: new Map((boardMetadata.state?.edges || []).map((edge) => [edge.id, edge.audit])),
  }), [boardMetadata.state]);
  const [showAccess, setShowAccess] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [hours, setHours] = useState("6");
  const [minutes, setMinutes] = useState("0");
  const [editingId, setEditingId] = useState(null);
  const [pendingConnection, setPendingConnection] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [inspectedId, setInspectedId] = useState(null);
  const [viewport, setViewport] = useState(initialViewport);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [isCapturing, setIsCapturing] = useState(false);
  const captureBusy = useRef(false);
  const reconnectingEdge = useRef(null);
  const flow = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const canvasRef = useRef(null);
  const canvasShellRef = useRef(null);
  const { isFullscreen, toggleFullscreen } = useMapFullscreen(canvasShellRef);
  const fitOnRestore = useRef(false);
  const nodesInitialized = useNodesInitialized();
  const mapById = useMemo(
    () => new Map(catalog.map((map) => [map.id, map])),
    [catalog],
  );
  const boardIds = useMemo(
    () => new Set(nodes.map((node) => node.data.mapId)),
    [nodes],
  );
  const selectedCount =
    nodes.filter((node) => node.selected).length +
    edges.filter((edge) => edge.selected).length;
  const snapshot = useMemo(
    () =>
      hydrated
        ? serializeBoard(nodes, edges, viewport, canvasRef.current?.clientWidth)
        : null,
    [nodes, edges, viewport, hydrated],
  );
  const {
    status: saveStatus,
    connection,
    flush,
  } = useBoardRealtime(board, snapshot, {
    onMetadata: setBoardMetadata,
    onModuleDisabled: () => onBack(),
    onBoardDeleted: () => onBack(),
    onRemote: (graph) => {
        setNow(Date.now());
      const restored = restoreBoard(
        { ...graph, version: 1, viewport },
        catalog,
      );
      setNodes((current) => {
        const previous = new Map(current.map((node) => [node.id, node]));
        return restored.nodes.map((node) => {
          const old = previous.get(node.id);
          if (
            old &&
            old.position.x === node.position.x &&
            old.position.y === node.position.y &&
            !!old.data.isHome === !!node.data.isHome
          )
            return old;
          return { ...old, ...node };
        });
      });
      setEdges((current) => {
        const previous = new Map(current.map((edge) => [edge.id, edge]));
        return restored.edges.map((edge) => ({
          ...previous.get(edge.id),
          ...edge,
        }));
      });
      const ids = new Set(restored.nodes.map((node) => node.id));
      setPendingConnection((current) =>
        current &&
        ids.has(current.source) &&
        ids.has(current.target) &&
        (!current.edgeId ||
          restored.edges.some((edge) => edge.id === current.edgeId))
          ? current
          : null,
      );
      setEditingId((current) =>
        restored.edges.some((edge) => edge.id === current) ? current : null,
      );
    },
  });
  const canEdit = boardMetadata.permissions.canEdit && saveStatus !== "denied";
  const canManage =
    boardMetadata.permissions.canManage && saveStatus !== "denied";
  const saved = saveStatus === "saved";
  const storageError = ["failed", "session", "conflict", "denied"].includes(
    saveStatus,
  );
  const saveLabel = !hydrated
    ? t("save.waiting")
    : saveStatus === "denied"
      ? t("save.denied")
      : ["connecting", "reconnecting"].includes(saveStatus)
        ? t("live." + saveStatus)
        : !canEdit
          ? t("sharing.readOnly")
          : t("save." + saveStatus);
  async function leaveBoard() {
    if (saveStatus === "denied") {
      if (window.confirm(t("sharing.discardChanges"))) onBack();
      return;
    }
    try {
      await flush();
      onBack();
    } catch {
      setNotice({ key: "library.leaveError", kind: "error" });
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    fetch(document.getElementById("mapper-root").dataset.catalogUrl, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("catalog");
        return response.json();
      })
      .then((data) => {
        if (!Array.isArray(data.maps)) throw new Error("catalog");
        setCatalog(data.maps);
        const restored = restoreBoard(board.state, data.maps);
        fitOnRestore.current =
          !Number.isFinite(board.state.canvasWidth) ||
          Math.abs(board.state.canvasWidth - canvasRef.current.clientWidth) >
            30;
        setNodes(restored.nodes);
        setEdges(restored.edges);
        let camera = restored.viewport;
        try {
          const stored = JSON.parse(
            localStorage.getItem(`avalon-roads:camera:${board.id}`),
          );
          if (
            Number.isFinite(stored?.x) &&
            Number.isFinite(stored?.y) &&
            Number.isFinite(stored?.zoom) &&
            stored.zoom >= 0.25 &&
            stored.zoom <= 1.8
          )
            camera = stored;
        } catch {
          /* The initial saved viewport remains usable. */
        }
        setViewport(camera);
        flow.setViewport(camera);
        setHydrated(true);
        setLoading(false);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setLoadError("errors.catalog");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [attempt, board, setNodes, setEdges, flow.setViewport]);
  useEffect(() => {
    if (hydrated && nodesInitialized && fitOnRestore.current) {
      fitOnRestore.current = false;
      flow.fitView({
        padding: 0.2,
        maxZoom: 1,
      });
    }
  }, [hydrated, nodesInitialized, flow.fitView]);
  useEffect(() => {
    const element = canvasRef.current;
    let width = element.clientWidth;
    let timeout;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (flow.getNodes().length)
          flow.fitView({
            padding: 0.2,
            maxZoom: 1,
            duration: 250,
          });
      }, 150);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [flow.fitView, flow.getNodes]);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 5500);
    return () => clearTimeout(timeout);
  }, [notice]);
  const showNotice = (key, kind = "success", values = {}) =>
    setNotice({ key, kind, values });
  const fit = () =>
    setTimeout(
      () =>
        flow.fitView({
          padding: 0.35,
          duration: 350,
          maxZoom: 1,
        }),
      80,
    );
  function centerPosition() {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return bounds
      ? flow.screenToFlowPosition({
          x: bounds.left + bounds.width / 2 - 126,
          y: bounds.top + bounds.height / 2 - 65,
        })
      : {
          x: 0,
          y: 0,
        };
  }
  function addMap(map) {
    if (!canEdit) return;
    const existing = nodes.find((node) => node.data.mapId === map.id);
    if (existing) {
      flow.setCenter(existing.position.x + 126, existing.position.y + 60, {
        zoom: 1,
        duration: 350,
      });
      showNotice("notices.mapExists", "success", {
        name: map.name,
      });
      return;
    }
    const position = centerPosition();
    const offset = (nodes.length % 4) * 35;
    setNodes((current) => [
      ...current,
      makeNode(map, {
        x: position.x + offset,
        y: position.y + offset,
      }),
    ]);
    showNotice("notices.mapAdded", "success", {
      name: map.name,
    });
  }
  function upsertConnection(
    sourceMapId,
    targetMapId,
    { connection = null, durationMinutes = null, edgeId = null } = {},
  ) {
    const sourceMap = mapById.get(sourceMapId);
    const targetMap = mapById.get(targetMapId);
    if (!sourceMap || !targetMap) {
      showNotice("errors.chooseMaps", "error");
      return false;
    }
    if (sourceMapId === targetMapId) {
      showNotice("errors.sameMap", "error");
      return false;
    }
    const duration =
      (durationMinutes ?? Number(hours) * 60 + Number(minutes)) * 60_000;
    if (!Number.isFinite(duration) || duration <= 0) {
      showNotice("errors.duration", "error");
      return false;
    }
    const source = nodeId(sourceMapId),
      target = nodeId(targetMapId);
    const updatedEdgeId = edgeId ?? (!connection ? editingId : null);
    if (connectionExists(edges, source, target, updatedEdgeId)) {
      showNotice("errors.duplicate", "error");
      return false;
    }
    const existingSource = nodes.find((node) => node.id === source);
    const existingTarget = nodes.find((node) => node.id === target);
    const origin =
      existingSource?.position ||
      (existingTarget
        ? {
            x: existingTarget.position.x,
            y: existingTarget.position.y - 225,
          }
        : centerPosition());
    const additions = [];
    if (!existingSource) additions.push(makeNode(sourceMap, origin));
    if (!existingTarget)
      additions.push(
        makeNode(targetMap, {
          x: origin.x,
          y: origin.y + 225,
        }),
      );
    if (additions.length) setNodes((current) => [...current, ...additions]);
    const timestamp = Date.now();
    setNow(timestamp);
    const previous = updatedEdgeId
      ? edges.find((item) => item.id === updatedEdgeId)
      : null;
    const handleFor = (id, fallback) =>
      previous?.source === id
        ? previous.sourceHandle
        : previous?.target === id
          ? previous.targetHandle
          : fallback;
    const edge = {
      id: updatedEdgeId || crypto.randomUUID(),
      selected: previous?.selected ?? false,
      source,
      target,
      sourceHandle: connection?.sourceHandle || handleFor(source, "bottom"),
      targetHandle: connection?.targetHandle || handleFor(target, "top"),
      type: "timed",
      data: {
        expiresAt: timestamp + duration,
      },
    };
    setEdges((current) => [
      ...current.filter((item) => item.id !== edge.id),
      edge,
    ]);
    showNotice(updatedEdgeId ? "notices.updated" : "notices.connected");
    if (!connection) setEditingId(null);
    if (additions.length) fit();
    return true;
  }
  const editEdge = useCallback(
    (id) => {
      const edge = edges.find((item) => item.id === id);
      if (!edge) return;
      if (isFullscreen || !SHOW_CONNECTION_FORM) {
        setPendingConnection({
          ...edge,
          edgeId: id,
        });
        setEdges((current) =>
          current.map((item) => ({
            ...item,
            selected: item.id === id,
          })),
        );
        return;
      }
      setEditingId(id);
      setEdges((current) =>
        current.map((item) => ({
          ...item,
          selected: item.id === id,
        })),
      );
      setFrom(
        nodes.find((node) => node.id === edge.source)?.data.mapId ?? null,
      );
      setTo(nodes.find((node) => node.id === edge.target)?.data.mapId ?? null);
      const left = Math.max(
        1,
        Math.min(1439, Math.ceil((edge.data.expiresAt - Date.now()) / 60_000)),
      );
      setHours(String(Math.floor(left / 60)));
      setMinutes(String(left % 60));
    },
    [edges, nodes, setEdges, isFullscreen],
  );
  function removeSelected() {
    const removedIds = new Set(
      nodes.filter((node) => node.selected).map((node) => node.id),
    );
    setNodes((current) => current.filter((node) => !node.selected));
    setEdges((current) =>
      current.filter(
        (edge) =>
          !edge.selected &&
          !removedIds.has(edge.source) &&
          !removedIds.has(edge.target),
      ),
    );
    setEditingId(null);
    if (removedIds.has(nodeId(inspectedId))) {
      setDrawer(null);
      setInspectedId(null);
    }
    showNotice("notices.removed");
  }
  function startCapture() {
    if (captureBusy.current || !nodes.length) return false;
    captureBusy.current = true;
    setIsCapturing(true);
    return true;
  }
  function finishCapture() {
    captureBusy.current = false;
    setIsCapturing(false);
  }
  async function exportBoard() {
    if (!startCapture()) return;
    try {
      const blob = await captureMap(canvasShellRef.current, flow);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "avalon-roads.png";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showNotice("notices.downloaded");
    } catch {
      showNotice("errors.capture", "error");
    } finally {
      finishCapture();
    }
  }
  async function copyBoard() {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      showNotice("errors.clipboardUnsupported", "error");
      return;
    }
    if (!startCapture()) return;
    try {
      const image = captureMap(canvasShellRef.current, flow);
      // Pass the promise immediately to retain the click's clipboard activation.
      const write = navigator.clipboard.write([
        new ClipboardItem({
          "image/png": image,
        }),
      ]);
      await Promise.all([image, write]);
      showNotice("notices.copied");
    } catch {
      showNotice("errors.copy", "error");
    } finally {
      finishCapture();
    }
  }
  const inspected = mapById.get(inspectedId);
  const edgeContext = useMemo(
    () => ({
      now,
      editEdge,
      canEdit,
    }),
    [now, editEdge, canEdit],
  );
  return (
    <AuditContext.Provider value={audits}><CatalogContext.Provider value={mapById}>
      <EdgeContext.Provider value={edgeContext}>
        <div className="app-shell">
          <header className="app-header">
            <Brand iconUrl={iconUrl} onMaps={leaveBoard} onMembers={user.permissions?.canManageMembers ? async () => {
              try { await flush(); onBack("members"); }
              catch { setNotice({ key: "library.leaveError", kind: "error" }); }
            } : undefined} />
            <div className="header-right">
              <DiscordStatus user={user} />
              <AccountMenu user={user} />
              <span className="draft-badge">
                <span />
                {t(
                  boardMetadata.scope === "guild"
                    ? "sharing.guild"
                    : "sharing.private",
                )}
              </span>
              {user.permissions?.canManageSettings && <button className="admin-link settings-link" onClick={async () => {
                try { await flush(); onBack("settings"); }
                catch { setNotice({ key: "library.leaveError", kind: "error" }); }
              }}>
                {t("modules.title")}
                <Icon name="arrow" size={15} />
              </button>}
            </div>
          </header>

          <main className={SHOW_CONNECTION_FORM ? "" : "map-only"}>
            <div className="page-heading">
              <div>
                <span className="eyebrow">{t("page.eyebrow")}</span>
                <h1>
                  <BoardName board={boardMetadata} canManage={canManage} />
                </h1>
                <p>{t("page.intro")}</p>
              </div>
            </div>

            {(canManage || boardMetadata.canDelete) && (
              <div className="board-sharing-actions">
                {boardMetadata.canDelete && saveStatus !== 'denied' && <button className="button board-delete-action" onClick={() => setShowDelete(true)}><Icon name="trash" size={15} />{t('library.delete')}</button>}
                {canManage && <button
                  className="button secondary"
                  onClick={() => setShowAccess(true)}
                >
                  <Icon name="link" size={16} />
                  {t("sharing.title")}
                </button>}
              </div>
            )}
            {/* Preserved for optional reactivation in config.js. */}
            {SHOW_CONNECTION_FORM && canEdit && (
              <section
                className={`connection-panel ${editingId ? "editing" : ""}`}
                aria-labelledby="connection-title"
              >
                <div className="panel-title">
                  <span className="panel-title-icon">
                    <Icon name="link" size={17} />
                  </span>
                  <h2 id="connection-title">
                    {editingId ? t("connection.edit") : t("connection.add")}
                  </h2>
                  <span className="panel-hint">
                    {editingId ? t("legacy.editHint") : t("legacy.addHint")}
                  </span>
                  {editingId && (
                    <button
                      className="text-button"
                      onClick={() => setEditingId(null)}
                    >
                      {t("legacy.cancelEdit")}
                    </button>
                  )}
                </div>
                <form
                  className="connection-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    upsertConnection(from, to);
                  }}
                >
                  <MapSelect
                    label={t("legacy.from")}
                    value={from}
                    onChange={setFrom}
                    catalog={catalog}
                    boardIds={boardIds}
                  />
                  <button
                    className="swap-button icon-button"
                    type="button"
                    aria-label={t("legacy.swap")}
                    onClick={() => {
                      setFrom(to);
                      setTo(from);
                    }}
                  >
                    <Icon name="swap" size={19} />
                  </button>
                  <MapSelect
                    label={t("legacy.to")}
                    value={to}
                    onChange={setTo}
                    catalog={catalog}
                    boardIds={boardIds}
                  />
                  <div className="duration-field">
                    <label>{t("legacy.timeLeft")}</label>
                    <div className="duration-input">
                      <Icon name="clock" size={16} />
                      <select
                        aria-label={t("legacy.hoursLeft")}
                        value={hours}
                        onChange={(event) => setHours(event.target.value)}
                      >
                        {Array.from(
                          {
                            length: 24,
                          },
                          (_, index) => (
                            <option key={index} value={index}>
                              {String(index).padStart(2, "0")} h
                            </option>
                          ),
                        )}
                      </select>
                      <span>:</span>
                      <select
                        aria-label={t("legacy.minutesLeft")}
                        value={minutes}
                        onChange={(event) => setMinutes(event.target.value)}
                      >
                        {Array.from(
                          {
                            length: 60,
                          },
                          (_, index) => (
                            <option key={index} value={index}>
                              {String(index).padStart(2, "0")} min
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>
                  <button
                    className="button primary connect-button"
                    type="submit"
                    disabled={!canEdit || loading || !!loadError}
                  >
                    <Icon name={editingId ? "check" : "plus"} size={18} />
                    {editingId ? t("connection.save") : t("connection.create")}
                  </button>
                </form>
              </section>
            )}

            <section
              ref={canvasShellRef}
              className={`canvas-shell ${isFullscreen ? "is-fullscreen" : ""}`}
              aria-label={t("board.editor")}
            >
              <div className="canvas-toolbar">
                <div className="canvas-label">
                  <span className="status-dot" />
                  <span>{t("board.exploration")}</span>
                  <span
                    className={`live-status ${connection}`}
                    role="status"
                    title={t("live." + connection)}
                  >
                    <span />
                    {t("live." + connection)}
                  </span>
                  <span className="toolbar-divider" />
                  <span className="map-count">
                    {t("board.maps", { count: nodes.length })}
                    <span> · </span>
                    {t("board.connections", { count: edges.length })}
                  </span>
                </div>
                <div className="canvas-actions">
                  <button
                    className="icon-button add-map-button"
                    disabled={!canEdit || loading || !!loadError}
                    aria-label={t("board.addMap")}
                    title={t("board.addMapTitle")}
                    onClick={() => {
                      setDrawer("catalog");
                      setInspectedId(null);
                    }}
                  >
                    <Icon name="plus" size={19} />
                  </button>
                  <button
                    className="tool-button"
                    disabled={!canEdit || !nodes.length}
                    onClick={() => {
                      const organized = organizeNodes(flow.getNodes(), edges);
                      setNodes(organized);
                      setEdges((current) => alignEdgeHandles(organized, current));
                      fit();
                    }}
                    title={t("board.organizeTitle")}
                  >
                    <Icon name="layout" size={16} />
                    <span>{t("board.organize")}</span>
                  </button>
                  <span className="toolbar-divider" />
                  <button
                    className="icon-button"
                    disabled={!canEdit || !selectedCount}
                    onClick={removeSelected}
                    aria-label={t("board.remove")}
                    title={t("board.remove")}
                  >
                    <Icon name="trash" size={17} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={!nodes.length || isCapturing}
                    onClick={copyBoard}
                    aria-label={t("board.copy")}
                    aria-busy={isCapturing}
                    title={t("board.copyTitle")}
                  >
                    <Icon name="copy" size={16} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={!nodes.length || isCapturing}
                    onClick={exportBoard}
                    aria-label={t("board.download")}
                    aria-busy={isCapturing}
                    title={t("board.downloadTitle")}
                  >
                    <Icon name="download" size={18} />
                  </button>
                  <button
                    className="icon-button danger"
                    disabled={!canEdit || !nodes.length}
                    aria-label={t("board.clear")}
                    title={t("board.clear")}
                    onClick={() => {
                      if (window.confirm(t("board.confirmClear"))) {
                        setNodes([]);
                        setEdges([]);
                        setEditingId(null);
                        setDrawer(null);
                      }
                    }}
                  >
                    <Icon name="close" size={19} />
                  </button>
                  <span className="toolbar-divider" />
                  <button
                    className="icon-button"
                    onClick={toggleFullscreen}
                    aria-pressed={isFullscreen}
                    aria-label={
                      isFullscreen
                        ? t("board.exitFullscreen")
                        : t("board.enterFullscreen")
                    }
                    title={
                      isFullscreen
                        ? t("board.exitFullscreenHint")
                        : t("board.fullscreen")
                    }
                  >
                    <Icon
                      name={isFullscreen ? "exitFullscreen" : "fullscreen"}
                      size={18}
                    />
                  </button>
                </div>
              </div>

              <div
                className={`canvas-area ${drawer ? "drawer-open" : ""}`}
                ref={canvasRef}
              >
                <ReactFlow
                  ariaLabelConfig={{
                    "node.a11yDescription.default": t("a11y.node"),
                    "node.a11yDescription.keyboardDisabled": t("a11y.nodeMove"),
                    "node.a11yDescription.ariaLiveMessage": ({
                      direction,
                      x,
                      y,
                    }) =>
                      t("a11y.moved", {
                        direction: t("a11y.directions." + direction, {
                          defaultValue: direction,
                        }),
                        x,
                        y,
                      }),
                    "edge.a11yDescription.default": t("a11y.edge"),
                    "controls.ariaLabel": t("a11y.controls"),
                    "controls.zoomIn.ariaLabel": t("a11y.zoomIn"),
                    "controls.zoomOut.ariaLabel": t("a11y.zoomOut"),
                    "controls.fitView.ariaLabel": t("a11y.fit"),
                    "minimap.ariaLabel": t("a11y.minimap"),
                  }}
                  nodes={nodes}
                  edges={edges.map((edge) => ({ ...edge, zIndex: 1,
                    className: `source-${edge.sourceHandle} target-${edge.targetHandle}` }))}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={(changes) => {
                    onEdgesChange(changes);
                    if (
                      changes.some(
                        (change) =>
                          change.type === "remove" && change.id === editingId,
                      )
                    )
                      setEditingId(null);
                  }}
                  onConnect={(connection) => {
                    if (!canEdit) return;
                    setEditingId(null);
                    setPendingConnection(connection);
                  }}
                  connectionRadius={32 / zoom}
                  onConnectEnd={(_, connection) => {
                    if (reconnectingEdge.current) return;
                    if (connection.isValid || !connection.fromNode) return;
                    const source = connection.fromNode.id;
                    const target = connection.toNode?.id;
                    if (source === target) {
                      showNotice("errors.sameMap", "error");
                    } else if (
                      target &&
                      connectionExists(edges, source, target)
                    ) {
                      showNotice("errors.duplicate", "error");
                    } else {
                      showNotice("errors.drop", "error");
                    }
                  }}
                  isValidConnection={(connection) =>
                    connection.source !== connection.target &&
                    !connectionExists(
                      edges,
                      connection.source,
                      connection.target,
                      reconnectingEdge.current,
                    )
                  }
                  onReconnectStart={(_, edge) => {
                    reconnectingEdge.current = edge.id;
                    setPendingConnection(null);
                  }}
                  onReconnect={canEdit ? (oldEdge, connection) => {
                    setEdges((current) => {
                      if (connection.source === connection.target || connectionExists(current, connection.source, connection.target, oldEdge.id)) return current;
                      return current.map((edge) => edge.id === oldEdge.id ? { ...edge, ...connection } : edge);
                    });
                  } : undefined}
                  onReconnectEnd={() => { reconnectingEdge.current = null; }}
                  reconnectRadius={12}
                  onNodeClick={(_, node) => {
                    setInspectedId(node.data.mapId);
                    setDrawer("detail");
                  }}
                  onEdgeDoubleClick={
                    canEdit ? (_, edge) => editEdge(edge.id) : undefined
                  }
                  onPaneClick={() => {
                    if (drawer === "detail") setDrawer(null);
                  }}
                  onNodesDelete={(removed) => {
                    if (removed.some((node) => node.data.mapId === inspectedId))
                      setDrawer(null);
                  }}
                  onMoveEnd={(_, nextViewport) => {
                    setViewport(nextViewport);
                    try {
                      localStorage.setItem(
                        `avalon-roads:camera:${board.id}`,
                        JSON.stringify(nextViewport),
                      );
                    } catch {
                      /* Camera persistence is optional. */
                    }
                  }}
                  defaultViewport={viewport}
                  minZoom={0.25}
                  maxZoom={1.8}
                  connectionMode={ConnectionMode.Loose}
                  nodesDraggable={canEdit}
                  nodesConnectable={canEdit}
                  edgesReconnectable={canEdit}
                  deleteKeyCode={canEdit ? ["Backspace", "Delete"] : null}
                  colorMode="dark"
                  snapToGrid
                  snapGrid={[15, 15]}
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={28}
                    size={1.25}
                    color="#343a3f"
                  />
                  <Controls showInteractive={false} />
                  {nodes.length > 0 && (
                    <MiniMap
                      nodeColor="#6688a2"
                      nodeStrokeColor="#9abbd4"
                      nodeBorderRadius={5}
                      maskColor="rgba(13, 16, 18, .7)"
                      pannable
                      zoomable
                    />
                  )}
                </ReactFlow>

                {(loading || loadError || !nodes.length) && (
                  <div className="empty-state">
                    <div className="empty-compass">
                      <Icon name={loadError ? "info" : "compass"} size={34} />
                    </div>
                    <span className="eyebrow">
                      {loading
                        ? t("empty.loadingCaption")
                        : loadError
                          ? t("empty.errorCaption")
                          : t("empty.caption")}
                    </span>
                    <h2>
                      {loading
                        ? t("empty.loading")
                        : loadError
                          ? t(loadError)
                          : t(canEdit ? "empty.title" : "sharing.emptyTitle")}
                    </h2>
                    <p>
                      {loadError
                        ? t("empty.retryHint")
                        : t(canEdit ? "empty.hint" : "sharing.emptyHint")}
                    </p>
                    {!loading && (loadError || canEdit) && (
                      <button
                        className="button secondary"
                        onClick={() =>
                          loadError
                            ? setAttempt((value) => value + 1)
                            : setDrawer("catalog")
                        }
                      >
                        <Icon name={loadError ? "swap" : "plus"} size={17} />
                        {loadError
                          ? t("common:actions.retry")
                          : t("empty.choose")}
                      </button>
                    )}
                  </div>
                )}

                {drawer === "catalog" && (
                  <CatalogDrawer
                    catalog={catalog}
                    nodes={nodes}
                    addMap={addMap}
                    close={() => setDrawer(null)}
                  />
                )}
                {drawer === "detail" && inspected && (
                  <MapInspector map={inspected} close={() => setDrawer(null)}
                    isHome={!!nodes.find((node) => node.data.mapId === inspected.id)?.data.isHome}
                    canEdit={canEdit}
                    onToggleHome={() => {
                      if (!canEdit || !inspected.is_hideout) return;
                      setNodes((current) => current.map((node) => node.data.mapId === inspected.id
                        ? { ...node, data: { ...node.data, isHome: !node.data.isHome } } : node));
                    }} />
                )}
              </div>
              <div className="canvas-footer">
                <span>
                  <Icon name="info" size={13} />
                  <span>
                    {t(canEdit ? "board.dragHint" : "sharing.readOnlyHint")}
                    <span className="desktop-tip" hidden={!canEdit}>
                      {" "}
                      {t("board.editHint")}
                    </span>
                  </span>
                </span>
                <span className={storageError ? "storage-error" : ""}>
                  <span className={`save-dot ${saved ? "saved" : ""}`} />
                  {saveLabel}
                  {storageError && saveStatus !== "denied" && (
                    <button
                      className="text-button"
                      onClick={() => {
                        if (saveStatus === "conflict") {
                          if (window.confirm(t("library.reloadConfirm")))
                            onReload();
                        } else {
                          flush().catch(() => {});
                        }
                      }}
                    >
                      {t(
                        saveStatus === "conflict"
                          ? "library.reload"
                          : "common:actions.retry",
                      )}
                    </button>
                  )}
                </span>
              </div>
            </section>
            <footer className="page-footer">
              <span>{guildName()} · {t("page.product")}</span>
              <span>
                {t(
                  boardMetadata.scope === "guild"
                    ? "sharing.guildSaved"
                    : "page.localOnly",
                )}
              </span>
            </footer>
          </main>
        </div>
        {notice &&
          createPortal(
            <div className={`toast ${notice.kind}`} role="status">
              <Icon
                name={notice.kind === "error" ? "info" : "check"}
                size={17}
              />
              <span>{t(notice.key, notice.values)}</span>
              <button
                aria-label={t("common:actions.closeNotice")}
                onClick={() => setNotice(null)}
              >
                <Icon name="close" size={15} />
              </button>
            </div>,
            canvasShellRef.current || document.body,
          )}
      </EdgeContext.Provider>
      {showAccess && (
        <BoardAccessPanel
          boardId={board.id}
          onClose={() => setShowAccess(false)}
          onSaved={(metadata) => {
            setBoardMetadata(metadata);
            setShowAccess(false);
          }}
        />
      )}
      {showDelete && <DeleteBoardDialog board={boardMetadata} onClose={() => setShowDelete(false)} onDeleted={() => onBack()} />}
      {canEdit &&
        pendingConnection &&
        createPortal(
          <ConnectionCard
            key={`${pendingConnection.edgeId || "new"}-${pendingConnection.source}-${pendingConnection.target}-${pendingConnection.targetHandle}`}
            anchor={{
              nodeId: pendingConnection.target,
              handleId: pendingConnection.targetHandle || "top",
            }}
            containerRef={canvasShellRef}
            areaRef={canvasRef}
            isEditing={!!pendingConnection.edgeId}
            initialDuration={
              pendingConnection.edgeId
                ? Math.max(
                    1,
                    Math.min(
                      1439,
                      Math.ceil(
                        (pendingConnection.data.expiresAt - Date.now()) /
                          60_000,
                      ),
                    ),
                  )
                : 360
            }
            source={mapById.get(
              nodes.find((node) => node.id === pendingConnection.source)?.data
                .mapId,
            )}
            target={mapById.get(
              nodes.find((node) => node.id === pendingConnection.target)?.data
                .mapId,
            )}
            onCancel={() => setPendingConnection(null)}
            onConfirm={(durationMinutes) => {
              const created = upsertConnection(
                nodes.find((node) => node.id === pendingConnection.source)?.data
                  .mapId,
                nodes.find((node) => node.id === pendingConnection.target)?.data
                  .mapId,
                {
                  connection: pendingConnection,
                  durationMinutes,
                  edgeId: pendingConnection.edgeId,
                },
              );
              if (created) setPendingConnection(null);
            }}
          />,
          canvasShellRef.current,
        )}
    </CatalogContext.Provider></AuditContext.Provider>
  );
}
createRoot(document.getElementById("mapper-root")).render(
  <React.StrictMode>
    <BoardLibrary Editor={App} />
    <FirstVisitLanguage />
  </React.StrictMode>,
);
