import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ReactFlowProvider } from "@xyflow/react";
import { Icon } from "./icons";
import { boardApi, libraryData } from "./boardApi";
import { AccountMenu, DiscordStatus } from "./AccountMenu";
import { Brand, guildName } from "./Brand";
import { MembersPage } from "./MembersPage";
import { SettingsPage } from "./SettingsPage";
import { BoardCard } from "./BoardCard";
import { DeleteBoardDialog } from "./DeleteBoardDialog";

export function BoardLibrary({ Editor }) {
  const { t } = useTranslation("mapper");
  const createDialog = useRef(null);
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [active, setActive] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("private");
  const [page, setPage] = useState(() => {
    const requested = new URLSearchParams(location.search).get("page");
    return ["members", "settings"].includes(requested) ? requested : "boards";
  });
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const label = active ? t("page.product")
      : page === "settings" && data?.user?.permissions?.canManageSettings ? t("modules.title")
      : page === "members" && data?.user?.permissions?.canManageMembers ? t("members.title")
      : data?.modules?.mapper === false ? "" : t("page.product");
    document.title = label ? `${guildName()} · ${label}` : guildName();
  }, [active, page, data?.modules?.mapper, data?.user?.permissions?.canManageSettings, data?.user?.permissions?.canManageMembers, t]);

  useEffect(() => {
    const url = new URL(location.href);
    const authError = url.searchParams.get("auth_error");
    if (["cancelled", "failed", "expired", "unavailable", "inactive", "membership_required"].includes(authError)) {
      setError("auth.errors." + authError);
      url.searchParams.delete("auth_error");
      history.replaceState(null, "", url.pathname + url.search);
    }
    const controller = new AbortController();
    libraryData({ signal: controller.signal })
      .then(async (result) => {
        setData(result);
        setScope(result.user?.permissions?.canCreateGuildMaps ? "guild" : "private");
        const id = new URLSearchParams(location.search).get("board");
        if (id && result.user?.canAccess && result.modules.mapper) {
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

  useEffect(() => {
    if (!data?.user) return;
    const controller = new AbortController();
    const interval = setInterval(() => {
      libraryData({ signal: controller.signal }).then((result) => {
        setData(result);
        if (!result.modules.mapper || !result.user?.canAccess) setActive(null);
      }).catch(() => {});
    }, data.user.approvalPending ? 5000 : 15000);
    return () => { clearInterval(interval); controller.abort(); };
  }, [data?.user?.id, data?.user?.approvalPending]);

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
      createDialog.current?.close();
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

  async function back(destination = "boards") {
    history.replaceState(null, "", destination === "boards" ? "/" : `/?page=${destination}`);
    setPage(destination);
    setActive(null);
    setError("");
    try {
      setData(await libraryData());
    } catch {
      setError("library.loadError");
    }
  }

  const visibleBoards = (data?.boards || [])
    .filter((board) => (filter === "all" || board.scope === filter) && board.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(b.scope === "guild") - Number(a.scope === "guild"));

  if (active)
    return (
      <ReactFlowProvider key={`${active.id}:${active.revision}`}>
        <Editor board={active} user={data.user} iconUrl={data.branding?.iconUrl} onBack={back} onReload={() => open(active)} />
      </ReactFlowProvider>
    );

  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand iconUrl={data?.branding?.iconUrl} page={page} showMaps={Boolean(data?.user?.canAccess && data?.modules?.mapper)} onMaps={() => back("boards")} onMembers={data?.user?.permissions?.canManageMembers ? () => back("members") : undefined} />
        <div className="header-right">
          <DiscordStatus user={data?.user} />
          <AccountMenu user={data?.user} />
          {data?.user?.permissions?.canManageSettings && <button className="admin-link settings-link" aria-current={page === "settings" ? "page" : undefined} onClick={() => back("settings")}>
            {t("modules.title")} <Icon name="arrow" size={15} />
          </button>}
        </div>
      </header>
      {page === "members" && data?.user?.permissions?.canManageMembers ? <MembersPage /> :
      page === "settings" && data?.user?.permissions?.canManageSettings ? <SettingsPage onChanged={() => back("settings")} /> :
      <main className="board-library board-home">
        <div className="page-heading library-page-heading">
          <div>
            <span className="eyebrow">{guildName()}</span>
            <h1>
              {t(data?.user?.canAccess && data.modules.mapper === false ? "modules.noneTitle" : "library.title")}
              <span>.</span>
            </h1>
            <p>{data?.user?.canAccess && data.modules.mapper ? t("library.count", { count: data.boards.length }) : t("library.intro")}</p>
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
        {data?.user?.approvalPending && (
          <section className="library-panel" aria-live="polite">
            <Icon name="compass" size={32} />
            <h2>{t("members.pendingTitle")}</h2>
            <p>{t("members.pendingHint")}</p>
            <button className="button secondary" onClick={() => back()}>{t("members.checkApproval")}</button>
          </section>
        )}
        {data && !data.user?.canAccess && !data.user?.approvalPending && (
          <section className="library-panel">
            <Icon name="compass" size={32} />
            <h2>{t("library.signInTitle")}</h2>
            <p>{t("library.signInHint")}</p>
            {data.user && <p role="alert">{t("auth.errors.membership_required")}</p>}
            {data.auth.discordEnabled ? <a className="button discord-button" href={`/auth/discord/login/?next=${encodeURIComponent(location.pathname + location.search)}`}>
              <Icon name="link" size={18} />{t("auth.discord")}
            </a> : <button className="button discord-button" disabled>{t("auth.discord")}</button>}
            {!data.auth.discordEnabled && <p className="muted">{t("auth.unavailable")}</p>}
            <a className="text-button" href="/admin/login/?next=/">{t("library.signIn")}</a>
          </section>
        )}
        {data?.user?.canAccess && !data.modules.mapper && (
          <section className="library-panel">
            <Icon name="compass" size={32} />
            <p>{t("modules.noneHint")}</p>
            {data.user.permissions.canManageSettings && <button className="button primary" onClick={() => back("settings")}>{t("modules.title")}</button>}
          </section>
        )}
        {data?.user?.canAccess && data.modules.mapper && (
          <>
            <dialog ref={createDialog} className="board-create-dialog" aria-labelledby="create-board-title" onCancel={(event) => { if (busy) event.preventDefault(); }} onClick={(event) => {
              if (busy || event.target !== event.currentTarget) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) createDialog.current.close();
            }}>
            <form className="board-create library-panel" onSubmit={create}>
              <div className="create-dialog-heading">
                <div><h2 id="create-board-title">{t("library.createTitle")}</h2>
                <p>{t("library.createHint")}</p></div>
                <button type="button" className="icon-button" disabled={busy} aria-label={t("library.closeCreate")} onClick={() => createDialog.current.close()}><Icon name="close" /></button>
              </div>
              {error && <p className="library-error" role="alert">{t(error)}</p>}
              <label className="board-name-label">
                {t("library.name")}
                <input
                  autoFocus
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
                  {data.user.permissions.canCreateGuildMaps && <option value="guild">{t("sharing.guild")}</option>}
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
            </dialog>
            <div className="library-toolbar">
              <label className="library-search"><Icon name="search" size={17} /><input aria-label={t("library.search")} placeholder={t("library.search")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <div className="library-toolbar-actions">
            <div className="board-filters" aria-label={t("sharing.filter")}>
              {["all", "guild", "private"].map((value) => (
                <button
                  key={value}
                  className={filter === value ? "active" : ""}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {t("sharing.filter_" + value)}<span>{data.boards.filter((board) => value === "all" || board.scope === value).length}</span>
                </button>
              ))}
            </div>
                <button className="button secondary library-create-button" aria-haspopup="dialog" onClick={() => createDialog.current.showModal()}><Icon name="plus" size={14} />{t("library.create")}</button>
              </div>
            </div>
            <div className="board-grid">
              {visibleBoards.map((board) => <BoardCard key={board.id} board={board} busy={busy} onOpen={open} onDelete={setDeleting} />)}
            </div>
            {data.boards.length > 0 && !visibleBoards.length && <div className="library-panel library-empty"><Icon name="search" size={28} /><h2>{t("library.noResults")}</h2><button className="button secondary" onClick={() => { setQuery(""); setFilter("all"); }}>{t("library.clearFilters")}</button></div>}
            {!data.boards.length && (
              <div className="library-panel library-empty">
                <Icon name="layout" size={30} />
                <h2>{t("library.empty")}</h2>
                <p>{t("library.emptyHint")}</p>
                <button className="button primary" onClick={() => createDialog.current.showModal()}><Icon name="plus" size={18} />{t("library.create")}</button>
              </div>
            )}
          </>
        )}
      </main>}
      {deleting && <DeleteBoardDialog board={deleting} onClose={() => setDeleting(null)} onDeleted={(id) => {
        setDeleting(null);
        setData((current) => ({ ...current, boards: current.boards.filter((item) => item.id !== id) }));
      }} />}
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
