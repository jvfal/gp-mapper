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
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { Icon } from "./icons";
import { MapSelect } from "./MapSelect";
import { ConnectionDialog } from "./ConnectionDialog";
import { useMapFullscreen } from "./useMapFullscreen";
import { CatalogContext, EdgeContext, MapNode, TimedEdge } from "./MapElements";
import { CatalogDrawer, MapInspector } from "./MapDrawer";
import {
  STORAGE_KEY,
  connectionExists,
  makeNode,
  nodeId,
  organizeNodes,
  restoreBoard,
  serializeBoard,
} from "./graph";

const nodeTypes = { roadMap: MapNode };
const edgeTypes = { timed: TimedEdge };
const initialViewport = { x: 0, y: 0, zoom: 1 };

function App() {
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
  const [saved, setSaved] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const flow = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const canvasRef = useRef(null);
  const canvasShellRef = useRef(null);
  const { isFullscreen, toggleFullscreen } = useMapFullscreen(canvasShellRef);
  const lastSaved = useRef("");
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
  const saveLabel = !hydrated
    ? "Aguardando catálogo"
    : storageError
      ? "Não foi possível salvar · Exporte o quadro"
      : saved
        ? "Salvo neste navegador"
        : "Salvando...";

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
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const board = JSON.parse(raw);
            const restored = restoreBoard(board, data.maps);
            fitOnRestore.current =
              !Number.isFinite(board.canvasWidth) ||
              Math.abs(board.canvasWidth - canvasRef.current.clientWidth) > 30;
            setNodes(restored.nodes);
            setEdges(restored.edges);
            setViewport(restored.viewport);
            flow.setViewport(restored.viewport);
          }
        } catch {
          setNotice({
            text: "Não foi possível recuperar o rascunho deste navegador.",
            kind: "error",
          });
        }
        setHydrated(true);
        setLoading(false);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setLoadError("Não foi possível carregar os mapas.");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [attempt, setNodes, setEdges, flow.setViewport]);

  useEffect(() => {
    if (hydrated && nodesInitialized && fitOnRestore.current) {
      fitOnRestore.current = false;
      flow.fitView({ padding: 0.2, maxZoom: 1 });
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
          flow.fitView({ padding: 0.2, maxZoom: 1, duration: 250 });
      }, 150);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [flow.fitView, flow.getNodes]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const serialized = JSON.stringify(
      serializeBoard(nodes, edges, viewport, canvasRef.current?.clientWidth),
    );
    if (serialized === lastSaved.current) return;
    setSaved(false);
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serialized);
        lastSaved.current = serialized;
        setSaved(true);
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [nodes, edges, viewport, hydrated]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 5500);
    return () => clearTimeout(timeout);
  }, [notice]);

  const showNotice = (text, kind = "success") => setNotice({ text, kind });
  const fit = () =>
    setTimeout(
      () => flow.fitView({ padding: 0.35, duration: 350, maxZoom: 1 }),
      80,
    );

  function centerPosition() {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return bounds
      ? flow.screenToFlowPosition({
          x: bounds.left + bounds.width / 2 - 126,
          y: bounds.top + bounds.height / 2 - 65,
        })
      : { x: 0, y: 0 };
  }

  function addMap(map) {
    const existing = nodes.find((node) => node.data.mapId === map.id);
    if (existing) {
      flow.setCenter(existing.position.x + 126, existing.position.y + 60, {
        zoom: 1,
        duration: 350,
      });
      showNotice(`${map.name} já está no quadro.`);
      return;
    }
    const position = centerPosition();
    const offset = (nodes.length % 4) * 35;
    setNodes((current) => [
      ...current,
      makeNode(map, { x: position.x + offset, y: position.y + offset }),
    ]);
    showNotice(`${map.name} adicionado.`);
  }

  function upsertConnection(
    sourceMapId,
    targetMapId,
    { connection = null, durationMinutes = null, edgeId = null } = {},
  ) {
    const sourceMap = mapById.get(sourceMapId);
    const targetMap = mapById.get(targetMapId);
    if (!sourceMap || !targetMap) {
      showNotice("Escolha os mapas de origem e destino.", "error");
      return false;
    }
    if (sourceMapId === targetMapId) {
      showNotice("Escolha dois mapas diferentes.", "error");
      return false;
    }
    const duration =
      (durationMinutes ?? Number(hours) * 60 + Number(minutes)) * 60_000;
    if (!Number.isFinite(duration) || duration <= 0) {
      showNotice("O tempo restante precisa ser maior que zero.", "error");
      return false;
    }
    const source = nodeId(sourceMapId),
      target = nodeId(targetMapId);
    const updatedEdgeId = edgeId ?? (!connection ? editingId : null);
    if (connectionExists(edges, source, target, updatedEdgeId)) {
      showNotice(
        "Essa conexão já existe. Clique no tempo dela para editar.",
        "error",
      );
      return false;
    }
    const existingSource = nodes.find((node) => node.id === source);
    const existingTarget = nodes.find((node) => node.id === target);
    const origin =
      existingSource?.position ||
      (existingTarget
        ? { x: existingTarget.position.x, y: existingTarget.position.y - 225 }
        : centerPosition());
    const additions = [];
    if (!existingSource) additions.push(makeNode(sourceMap, origin));
    if (!existingTarget)
      additions.push(makeNode(targetMap, { x: origin.x, y: origin.y + 225 }));
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
      data: { expiresAt: timestamp + duration },
    };
    setEdges((current) => [
      ...current.filter((item) => item.id !== edge.id),
      edge,
    ]);
    showNotice(updatedEdgeId ? "Conexão atualizada." : "Conexão adicionada.");
    if (!connection) setEditingId(null);
    if (additions.length) fit();
    return true;
  }

  const editEdge = useCallback(
    (id) => {
      const edge = edges.find((item) => item.id === id);
      if (!edge) return;
      if (isFullscreen) {
        setPendingConnection({ ...edge, edgeId: id });
        setEdges((current) =>
          current.map((item) => ({ ...item, selected: item.id === id })),
        );
        return;
      }
      setEditingId(id);
      setEdges((current) =>
        current.map((item) => ({ ...item, selected: item.id === id })),
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
    showNotice("Seleção removida.");
  }

  function exportBoard() {
    const blob = new Blob(
      [JSON.stringify(serializeBoard(nodes, edges, viewport), null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "avalon-roads.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showNotice("Quadro exportado.");
  }

  async function copyBoard() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(serializeBoard(nodes, edges, viewport), null, 2),
      );
      showNotice("Quadro copiado.");
    } catch {
      showNotice("Não foi possível copiar. Use o botão Exportar.", "error");
    }
  }

  const inspected = mapById.get(inspectedId);
  const edgeContext = useMemo(() => ({ now, editEdge }), [now, editEdge]);

  return (
    <CatalogContext.Provider value={mapById}>
      <EdgeContext.Provider value={edgeContext}>
        <div className="app-shell">
          <header className="app-header">
            <a href="/" className="brand" aria-label="Avalon Roads, início">
              <span className="brand-mark">
                <Icon name="compass" size={25} />
              </span>
              <span>
                AVALON<span className="brand-roads">ROADS</span>
              </span>
              <span className="brand-divider" />
              <span className="brand-product">Mapper</span>
            </a>
            <div className="header-right">
              <span className="draft-badge">
                <span />
                Rascunho local
              </span>
              <a
                className="admin-link"
                href="/admin/"
                title="Abrir administração"
              >
                Admin
                <Icon name="arrow" size={15} />
              </a>
            </div>
          </header>

          <main>
            <div className="page-heading">
              <div>
                <span className="eyebrow">SEU CAMINHO PELAS ROADS</span>
                <h1>
                  Mapa de conexões<span>.</span>
                </h1>
                <p>
                  Conecte mapas, acompanhe os portais e planeje sua próxima
                  rota.
                </p>
              </div>
              <button
                className="button secondary catalog-open"
                onClick={() => {
                  setDrawer("catalog");
                  setInspectedId(null);
                }}
                disabled={loading || !!loadError}
              >
                <Icon name="plus" size={17} />
                Adicionar mapa
                <span className="shortcut-count">{catalog.length}</span>
              </button>
            </div>

            <section
              className={`connection-panel ${editingId ? "editing" : ""}`}
              aria-labelledby="connection-title"
            >
              <div className="panel-title">
                <span className="panel-title-icon">
                  <Icon name="link" size={17} />
                </span>
                <h2 id="connection-title">
                  {editingId ? "Editar conexão" : "Adicionar conexão"}
                </h2>
                <span className="panel-hint">
                  {editingId
                    ? "Ajuste os mapas ou renove o tempo restante."
                    : "Selecione dois mapas para abrir um novo caminho."}
                </span>
                {editingId && (
                  <button
                    className="text-button"
                    onClick={() => setEditingId(null)}
                  >
                    Cancelar edição
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
                  label="De"
                  value={from}
                  onChange={setFrom}
                  catalog={catalog}
                  boardIds={boardIds}
                />
                <button
                  className="swap-button icon-button"
                  type="button"
                  aria-label="Inverter origem e destino"
                  onClick={() => {
                    setFrom(to);
                    setTo(from);
                  }}
                >
                  <Icon name="swap" size={19} />
                </button>
                <MapSelect
                  label="Para"
                  value={to}
                  onChange={setTo}
                  catalog={catalog}
                  boardIds={boardIds}
                />
                <div className="duration-field">
                  <label>Tempo restante</label>
                  <div className="duration-input">
                    <Icon name="clock" size={16} />
                    <select
                      aria-label="Horas restantes"
                      value={hours}
                      onChange={(event) => setHours(event.target.value)}
                    >
                      {Array.from({ length: 24 }, (_, index) => (
                        <option key={index} value={index}>
                          {String(index).padStart(2, "0")} h
                        </option>
                      ))}
                    </select>
                    <span>:</span>
                    <select
                      aria-label="Minutos restantes"
                      value={minutes}
                      onChange={(event) => setMinutes(event.target.value)}
                    >
                      {Array.from({ length: 60 }, (_, index) => (
                        <option key={index} value={index}>
                          {String(index).padStart(2, "0")} min
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  className="button primary connect-button"
                  type="submit"
                  disabled={loading || !!loadError}
                >
                  <Icon name={editingId ? "check" : "plus"} size={18} />
                  {editingId ? "Salvar conexão" : "Criar conexão"}
                </button>
              </form>
            </section>

            <section
              ref={canvasShellRef}
              className={`canvas-shell ${isFullscreen ? "is-fullscreen" : ""}`}
              aria-label="Editor de conexões"
            >
              <div className="canvas-toolbar">
                <div className="canvas-label">
                  <span className="status-dot" />
                  <span>Exploração</span>
                  <span className="toolbar-divider" />
                  <span className="map-count">
                    {nodes.length} mapas<span> · </span>
                    {edges.length} conexões
                  </span>
                </div>
                <div className="canvas-actions">
                  <button
                    className="icon-button add-map-button"
                    disabled={loading || !!loadError}
                    aria-label="Adicionar mapa pelo catálogo"
                    title="Adicionar mapa"
                    onClick={() => {
                      setDrawer("catalog");
                      setInspectedId(null);
                    }}
                  >
                    <Icon name="plus" size={19} />
                  </button>
                  <button
                    className="tool-button"
                    disabled={!nodes.length}
                    onClick={() => {
                      setNodes((current) => organizeNodes(current, edges));
                      fit();
                    }}
                    title="Organizar mapas"
                  >
                    <Icon name="layout" size={16} />
                    <span>Organizar</span>
                  </button>
                  <span className="toolbar-divider" />
                  <button
                    className="icon-button"
                    disabled={!selectedCount}
                    onClick={removeSelected}
                    aria-label="Remover seleção"
                    title="Remover seleção"
                  >
                    <Icon name="trash" size={17} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={!nodes.length}
                    onClick={copyBoard}
                    aria-label="Copiar quadro"
                    title="Copiar quadro"
                  >
                    <Icon name="copy" size={16} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={!nodes.length}
                    onClick={exportBoard}
                    aria-label="Exportar quadro"
                    title="Exportar quadro"
                  >
                    <Icon name="download" size={18} />
                  </button>
                  <button
                    className="icon-button danger"
                    disabled={!nodes.length}
                    aria-label="Limpar quadro"
                    title="Limpar quadro"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Limpar todos os mapas e conexões deste rascunho?",
                        )
                      ) {
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
                        ? "Sair da tela cheia"
                        : "Abrir mapa em tela cheia"
                    }
                    title={
                      isFullscreen ? "Sair da tela cheia (Esc)" : "Tela cheia"
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
                  nodes={nodes}
                  edges={edges}
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
                    setEditingId(null);
                    setPendingConnection(connection);
                  }}
                  connectionRadius={32 / zoom}
                  onConnectEnd={(_, connection) => {
                    if (connection.isValid || !connection.fromNode) return;
                    const source = connection.fromNode.id;
                    const target = connection.toNode?.id;
                    if (source === target) {
                      showNotice("Escolha dois mapas diferentes.", "error");
                    } else if (
                      target &&
                      connectionExists(edges, source, target)
                    ) {
                      showNotice(
                        "Essa conexão já existe. Clique no tempo dela para editar.",
                        "error",
                      );
                    } else {
                      showNotice(
                        "Solte a conexão perto de um ponto de outro mapa.",
                        "error",
                      );
                    }
                  }}
                  isValidConnection={(connection) =>
                    connection.source !== connection.target &&
                    !connectionExists(
                      edges,
                      connection.source,
                      connection.target,
                    )
                  }
                  onNodeClick={(_, node) => {
                    setInspectedId(node.data.mapId);
                    setDrawer("detail");
                  }}
                  onEdgeClick={(_, edge) => editEdge(edge.id)}
                  onPaneClick={() => {
                    if (drawer === "detail") setDrawer(null);
                  }}
                  onNodesDelete={(removed) => {
                    if (removed.some((node) => node.data.mapId === inspectedId))
                      setDrawer(null);
                  }}
                  onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
                  defaultViewport={viewport}
                  minZoom={0.25}
                  maxZoom={1.8}
                  connectionMode={ConnectionMode.Loose}
                  deleteKeyCode={["Backspace", "Delete"]}
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
                        ? "PREPARANDO A EXPLORAÇÃO"
                        : loadError
                          ? "CATÁLOGO INDISPONÍVEL"
                          : "UM NOVO CAMINHO"}
                    </span>
                    <h2>
                      {loading
                        ? "Carregando os mapas..."
                        : loadError || "Toda rota começa com um mapa."}
                    </h2>
                    <p>
                      {loadError
                        ? "Verifique sua conexão e tente novamente."
                        : "Adicione um mapa do catálogo ou crie sua primeira conexão no formulário acima."}
                    </p>
                    {!loading && (
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
                          ? "Tentar novamente"
                          : "Escolher primeiro mapa"}
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
                  <MapInspector map={inspected} close={() => setDrawer(null)} />
                )}
              </div>
              <div className="canvas-footer">
                <span>
                  <Icon name="info" size={13} />
                  <span>
                    Arraste os mapas para organizar
                    <span className="desktop-tip">
                      {" "}
                      · Clique nos ícones de tempo para editar conexões
                    </span>
                  </span>
                </span>
                <span className={storageError ? "storage-error" : ""}>
                  <span className={`save-dot ${saved ? "saved" : ""}`} />
                  {saveLabel}
                </span>
              </div>
            </section>
            <footer className="page-footer">
              <span>AVALON ROADS MAPPER</span>
              <span>Seu rascunho é salvo apenas neste navegador.</span>
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
              <span>{notice.text}</span>
              <button aria-label="Fechar aviso" onClick={() => setNotice(null)}>
                <Icon name="close" size={15} />
              </button>
            </div>,
            canvasShellRef.current || document.body,
          )}
      </EdgeContext.Provider>
      {pendingConnection &&
        createPortal(
          <ConnectionDialog
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
    </CatalogContext.Provider>
  );
}

createRoot(document.getElementById("mapper-root")).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  </React.StrictMode>,
);
