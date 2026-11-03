import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ReactFlowProvider } from "@xyflow/react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Icon } from "./icons";
import { boardApi } from "./boardApi";

export function BoardLibrary({ Editor }) {
  const { t, i18n } = useTranslation("mapper");
  const [data, setData] = useState(null);
  const [active, setActive] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("guild");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const controller = new AbortController();
    boardApi("", { signal: controller.signal })
      .then(async (result) => {
        setData(result);
        const id = new URLSearchParams(location.search).get("board");
        if (id && result.user) {
          const detail = await boardApi(`${encodeURIComponent(id)}/`, {
            signal: controller.signal,
          });
          setActive(detail.board);
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError") setError("library.loadError");
      });
    return () => controller.abort();
  }, []);

  async function open(board) {
    setBusy(true);
    setError("");
    try {
      const result = await boardApi(`${board.id}/`);
      setActive(result.board);
      history.replaceState(null, "", `/?board=${result.board.id}`);
    } catch (error) {
      setError(
        error.status === 401 || error.status === 403
          ? "library.sessionError"
          : "library.openError",
      );
    } finally {
      setBusy(false);
    }
  }

  async function create(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await boardApi("", {
        method: "POST",
        body: {
          name: name.trim(),
          scope,
        },
      });
      setName("");
      setActive(result.board);
      history.replaceState(null, "", `/?board=${result.board.id}`);
    } catch (error) {
      setError(
        error.status === 401 || error.status === 403
          ? "library.sessionError"
          : "library.createError",
      );
    } finally {
      setBusy(false);
    }
  }

  async function back() {
    history.replaceState(null, "", "/");
    setActive(null);
    setError("");
    try {
      setData(await boardApi());
    } catch {
      setError("library.loadError");
    }
  }

  if (active)
    return (
      <ReactFlowProvider key={`${active.id}:${active.revision}`}>
        <Editor board={active} onBack={back} onReload={() => open(active)} />
      </ReactFlowProvider>
    );

  return (
    <div className="app-shell">
      <header className="app-header">
        <a href="/" className="brand">
          <span className="brand-mark">
            <Icon name="compass" size={25} />
          </span>
          <span>
            AVALON<span className="brand-roads">ROADS</span>
          </span>
          <span className="brand-product">Mapper</span>
        </a>
        <div className="header-right">
          <LanguageSwitcher />
          <a className="admin-link" href="/admin/">
            Admin <Icon name="arrow" size={15} />
          </a>
        </div>
      </header>
      <main className="board-library">
        <div className="page-heading">
          <div>
            <span className="eyebrow">AVALON ROADS</span>
            <h1>
              {t("library.title")}
              <span>.</span>
            </h1>
            <p>
              {data?.user
                ? t("library.welcome", { name: data.user.name })
                : t("library.intro")}
            </p>
          </div>
        </div>
        {error && (
          <div className="library-error" role="alert">
            {t(error)}{" "}
            <button className="text-button" onClick={() => location.reload()}>
              {t("common:actions.retry")}
            </button>
          </div>
        )}
        {!data && !error && (
          <p className="muted" role="status">
            {t("library.loading")}
          </p>
        )}
        {data && !data.user && (
          <section className="library-panel">
            <Icon name="compass" size={32} />
            <h2>{t("library.signInTitle")}</h2>
            <p>{t("library.signInHint")}</p>
            <a className="button primary" href="/admin/login/?next=/">
              {t("library.signIn")}
            </a>
          </section>
        )}
        {data?.user && (
          <>
            <form className="board-create library-panel" onSubmit={create}>
              <div>
                <h2>{t("library.createTitle")}</h2>
                <p>{t("library.createHint")}</p>
              </div>
              <label className="board-name-label">
                {t("library.name")}
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("library.namePlaceholder")}
                />
              </label>
              <label className="board-name-label board-scope-label">
                {t("sharing.scope")}
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                >
                  <option value="guild">{t("sharing.guild")}</option>
                  <option value="private">{t("sharing.private")}</option>
                </select>
              </label>
              <button
                className="button primary"
                disabled={busy || !name.trim()}
              >
                <Icon name="plus" size={18} />
                {t("library.create")}
              </button>
            </form>
            <div className="library-list-heading">
              <h2>{t("library.existing")}</h2>
              <span className="muted">
                {t("library.count", { count: data.boards.length })}
              </span>
            </div>
            <div className="board-filters" aria-label={t("sharing.filter")}>
              {["all", "guild", "private"].map((value) => (
                <button
                  key={value}
                  className={filter === value ? "active" : ""}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {t("sharing.filter_" + value)}
                </button>
              ))}
            </div>
            <div className="board-grid">
              {data.boards
                .filter((board) => filter === "all" || board.scope === filter)
                .map((board) => (
                  <button
                    className="saved-board"
                    key={board.id}
                    disabled={busy}
                    onClick={() => open(board)}
                  >
                    <span className="saved-board-icon">
                      <Icon name="layout" size={24} />
                    </span>
                    <div className="board-badges">
                      <span>{t("sharing.filter_" + board.scope)}</span>
                      <span>
                        {t(
                          board.permissions.canManage
                            ? "sharing.owner"
                            : board.permissions.canEdit
                              ? "sharing.editor"
                              : "sharing.viewer",
                        )}
                      </span>
                    </div>
                    <h3>{board.name}</h3>
                    <p>
                      {t("board.maps", { count: board.nodeCount })} ·{" "}
                      {t("board.connections", { count: board.connectionCount })}
                    </p>
                    <small>
                      {t("library.updated", {
                        date: new Date(board.updatedAt).toLocaleString(
                          i18n.resolvedLanguage,
                        ),
                      })}
                    </small>
                    <span className="saved-board-open">
                      {t("library.open")}
                      <Icon name="arrow" size={16} />
                    </span>
                  </button>
                ))}
            </div>
            {!data.boards.length && (
              <div className="library-panel library-empty">
                <Icon name="layout" size={30} />
                <h2>{t("library.empty")}</h2>
                <p>{t("library.emptyHint")}</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export function BoardName({ board, canManage }) {
  const { t } = useTranslation("mapper");
  const [name, setName] = useState(board.name);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function rename(event) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    try {
      const result = await boardApi(`${board.id}/`, {
        method: "PATCH",
        body: { name: name.trim() },
      });
      setName(result.board.name);
      setEditing(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!editing) setName(board.name);
  }, [board.name]);
  if (!canManage) return <span>{name}</span>;
  if (!editing)
    return (
      <button
        className="board-title-button"
        title={t("library.rename")}
        onClick={() => setEditing(true)}
      >
        {name}
        <span>{t("library.rename")}</span>
      </button>
    );
  return (
    <form className="board-rename" onSubmit={rename}>
      <input
        autoFocus
        aria-label={t("library.name")}
        required
        maxLength={100}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button className="button secondary" disabled={busy || !name.trim()}>
        {t("library.saveName")}
      </button>
      {error && <span role="alert">{t("library.renameError")}</span>}
    </form>
  );
}
