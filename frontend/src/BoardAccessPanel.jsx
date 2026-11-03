import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { boardApi } from "./boardApi";
import { Icon } from "./icons";

export function BoardAccessPanel({ boardId, onClose, onSaved }) {
  const { t } = useTranslation("mapper");
  const dialog = useRef(null);
  const [settings, setSettings] = useState(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current.showModal();
    const controller = new AbortController();
    boardApi(`${boardId}/access/`, { signal: controller.signal })
      .then((result) => setSettings(result.access))
      .catch((error) => {
        if (error.name !== "AbortError") setError("sharing.loadError");
      });
    return () => controller.abort();
  }, [boardId]);
  function grant(id, field, value) {
    setSettings((current) => ({
      ...current,
      users: current.users.map((user) =>
        user.id !== id
          ? user
          : {
              ...user,
              [field]: value,
              ...(field === "canEdit" && value ? { canView: true } : {}),
              ...(field === "canView" && !value ? { canEdit: false } : {}),
            },
      ),
    }));
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await boardApi(`${boardId}/access/`, {
        method: "PUT",
        body: settings,
      });
      onSaved(result.board);
    } catch {
      setError("sharing.saveError");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="board-access-dialog"
      aria-labelledby="access-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="access-heading">
          <div>
            <span className="eyebrow">AVALON ROADS</span>
            <h2 id="access-title">{t("sharing.title")}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t("sharing.close")}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="muted">{t("sharing.ownerHint")}</p>
        {error && (
          <p className="library-error" role="alert">
            {t(error)}
          </p>
        )}
        {!settings && !error && <p role="status">{t("sharing.loading")}</p>}
        {settings && (
          <>
            <label className="board-name-label">
              {t("sharing.scope")}
              <select
                value={settings.scope}
                onChange={(event) =>
                  setSettings({ ...settings, scope: event.target.value })
                }
              >
                <option value="private">{t("sharing.private")}</option>
                <option value="guild">{t("sharing.guild")}</option>
              </select>
            </label>
            {settings.scope === "guild" && (
              <>
                <div className="access-audience">
                  <label className="board-name-label">
                    {t("sharing.whoViews")}
                    <select
                      value={settings.guildCanView ? "all" : "selected"}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          guildCanView: event.target.value === "all",
                          ...(event.target.value === "selected"
                            ? { guildCanEdit: false }
                            : {}),
                        })
                      }
                    >
                      <option value="all">{t("sharing.allMembers")}</option>
                      <option value="selected">
                        {t("sharing.selectedMembers")}
                      </option>
                    </select>
                  </label>
                  <label className="board-name-label">
                    {t("sharing.whoEdits")}
                    <select
                      value={settings.guildCanEdit ? "all" : "selected"}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          guildCanEdit: event.target.value === "all",
                          ...(event.target.value === "all"
                            ? { guildCanView: true }
                            : {}),
                        })
                      }
                    >
                      <option value="selected">
                        {t("sharing.selectedMembers")}
                      </option>
                      <option value="all">{t("sharing.allMembers")}</option>
                    </select>
                  </label>
                </div>
                <p className="muted">{t("sharing.membersHint")}</p>
                <label className="board-name-label">
                  {t("sharing.search")}
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <div className="access-members">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("sharing.member")}</th>
                        <th>{t("sharing.view")}</th>
                        <th>{t("sharing.edit")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settings.users
                        .filter((user) =>
                          user.name.toLowerCase().includes(query.toLowerCase()),
                        )
                        .map((user) => (
                          <tr key={user.id}>
                            <td>{user.name}</td>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={t("sharing.allowView", {
                                  name: user.name,
                                })}
                                checked={settings.guildCanView || user.canView}
                                disabled={settings.guildCanView || busy}
                                onChange={(event) =>
                                  grant(
                                    user.id,
                                    "canView",
                                    event.target.checked,
                                  )
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={t("sharing.allowEdit", {
                                  name: user.name,
                                })}
                                checked={settings.guildCanEdit || user.canEdit}
                                disabled={settings.guildCanEdit || busy}
                                onChange={(event) =>
                                  grant(
                                    user.id,
                                    "canEdit",
                                    event.target.checked,
                                  )
                                }
                              />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!settings.users.length && (
                    <p className="muted">{t("sharing.noMembers")}</p>
                  )}
                </div>
                {!settings.guildCanEdit && (
                  <p className="muted">{t("sharing.editIncludesView")}</p>
                )}
              </>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                type="button"
                onClick={onClose}
              >
                {t("common:actions.cancel")}
              </button>
              <button className="button primary" disabled={busy}>
                {t("sharing.save")}
              </button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}
