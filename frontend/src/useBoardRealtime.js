import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BoardSync } from "./boardSync";

export function useBoardRealtime(board, snapshot, callbacks) {
  const [status, setStatus] = useState("connecting");
  const [connection, setConnection] = useState("connecting");
  const handlers = useRef(callbacks);
  handlers.current = callbacks;
  const engineRef = useRef(null);
  if (!engineRef.current)
    engineRef.current = new BoardSync(board, {
      status: setStatus,
      connection: setConnection,
      apply: (graph) => handlers.current.onRemote(graph),
      metadata: (value) => handlers.current.onMetadata(value),
    });
  const engine = engineRef.current;
  const hydrated = snapshot !== null;
  useLayoutEffect(() => {
    if (snapshot) engine.observe(snapshot);
  }, [snapshot, engine]);
  useEffect(() => {
    if (!hydrated) return;
    let stopped = false,
      socket,
      retry,
      attempts = 0;
    function connect() {
      if (stopped) return;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/boards/${board.id}/`,
      );
      socket = ws;
      engine.attach(socket);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'board.deleted') {
            stopped = true;
            engine.receive({ type: 'denied' });
            handlers.current.onBoardDeleted?.();
            return;
          }
          if (message.type === "module.disabled") {
            stopped = true;
            engine.receive({ type: "denied" });
            handlers.current.onModuleDisabled?.();
            return;
          }
          engine.receive(message);
          attempts = 0;
        } catch {
          ws.close();
        }
      };
      socket.onclose = (event) => {
        if (stopped) return;
        engine.disconnected();
        if (event.code === 4404) {
          stopped = true;
          engine.receive({ type: 'denied' });
          handlers.current.onBoardDeleted?.();
          return;
        }
        if (event.code === 4403) {
          engine.receive({ type: "denied" });
          return;
        }
        retry = setTimeout(
          connect,
          Math.min(10_000, 500 * 2 ** Math.min(attempts++, 5)),
        );
      };
      socket.onerror = () => ws.close();
    }
    const sync = () => {
      if (socket?.readyState === 1)
        socket.send(JSON.stringify({ type: "sync" }));
    };
    const heartbeat = setInterval(sync, 15_000);
    const visible = () => {
      if (document.visibilityState === "visible") sync();
    };
    const beforeUnload = (event) => {
      if (!engine.dirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("beforeunload", beforeUnload);
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("beforeunload", beforeUnload);
      if (socket) {
        socket.onmessage = socket.onclose = socket.onerror = null;
        socket.close();
      }
      engine.dispose();
    };
  }, [board.id, engine, hydrated]);
  return { status, connection, flush: () => engine.flush() };
}
