import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiRequest } from "./boardApi";
import { Switch } from "./Switch";
import { Icon } from "./icons";

const emptyRole = { name: "", discordRoleId: "", canViewGuildMaps: true, canCreateGuildMaps: false, canDeleteGuildMaps: false };

function MemberAvatar({ member }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [member.avatarUrl]);
  return <span className="member-avatar" aria-hidden="true">
    {member.avatarUrl && !broken ? <img src={member.avatarUrl} alt="" width="40" height="40" loading="lazy" onError={() => setBroken(true)} /> : member.name.slice(0, 1).toLocaleUpperCase()}
  </span>;
}

export function MembersPage() {
  const { t, i18n } = useTranslation("mapper");
  const rolesDialog = useRef(null);
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function load() {
    const result = await apiRequest("/api/members/");
    setData(result);
  }
  useEffect(() => {
    const controller = new AbortController();
    apiRequest("/api/members/", { signal: controller.signal }).then(setData).catch((error) => {
      if (error.name !== "AbortError") setError("members.error");
    });
    return () => controller.abort();
  }, []);

  async function save(action) {
    if (busy) return;
    setBusy(true); setError(""); setSaved(false);
    try { await action(); await load(); setSaved(true); }
    catch (error) {
      const messages = { duplicate_role: "members.duplicate", invalid_discord_role_id: "members.invalidDiscordRole", invalid_guild: "members.wrongGuild", guild_not_configured: "members.guildNotConfigured" };
      setError(messages[error.code] || "members.error");
    }
    finally { setBusy(false); }
  }

  function renderRoleForm() {
    return (
        <form className="role-form" onSubmit={(event) => {
          event.preventDefault();
          save(async () => {
            await apiRequest(role.id ? `/api/roles/${role.id}/` : "/api/roles/", { method: role.id ? "PUT" : "POST", body: role });
            setRole(null);
          });
        }}>
          <h3>{t(role.id ? "members.editRole" : "members.newRole")}</h3>
          <label className="board-name-label">{t("members.roleName")}
            <input required maxLength={60} value={role.isDefault ? t("members.defaultRole") : role.name} disabled={role.isDefault || busy} onChange={(event) => setRole({ ...role, name: event.target.value })} />
          </label>
          <label className="board-name-label">{t("members.discordRoleId")}
            <input inputMode="numeric" pattern="[0-9]{1,20}" maxLength={20} placeholder={t("members.discordRolePlaceholder")} disabled={busy} value={role.discordRoleId || ""} onChange={(event) => setRole({ ...role, discordRoleId: event.target.value })} />
          </label>
          <p className="muted">{t("members.discordRoleHint")}</p>
          <Switch disabled={busy} checked={role.canViewGuildMaps} onChange={(event) => setRole({ ...role, canViewGuildMaps: event.target.checked, ...(!event.target.checked ? { canCreateGuildMaps: false, canDeleteGuildMaps: false } : {}) })} label={t("members.viewMaps")} />
          <Switch disabled={busy} checked={role.canCreateGuildMaps} onChange={(event) => setRole({ ...role, canCreateGuildMaps: event.target.checked, ...(event.target.checked ? { canViewGuildMaps: true } : {}) })} label={t("members.createMaps")} />
          <Switch disabled={busy} checked={Boolean(role.canDeleteGuildMaps)} onChange={(event) => setRole({ ...role, canDeleteGuildMaps: event.target.checked, ...(event.target.checked ? { canViewGuildMaps: true } : {}) })} label={t("members.deleteMaps")} />
          <p className="muted">{t("members.mapPermissionsHint")}</p>
          <div className="role-actions">
            <button className="button primary" disabled={busy || !role.name.trim()}>{t("members.saveRole")}</button>
            <button className="button" type="button" disabled={busy} onClick={() => setRole(null)}>{t("common:actions.cancel")}</button>
          </div>
          {role.id && !role.isDefault && <button className="text-button delete-role" type="button" disabled={busy} onClick={() => {
            if (window.confirm(t("members.deleteConfirm", { name: role.name }))) save(async () => {
              await apiRequest(`/api/roles/${role.id}/`, { method: "DELETE" }); setRole(null);
            });
          }}><Icon name="trash" size={16} />{t("members.deleteRole")}</button>}
        </form>
    );
  }

  return <main className="board-library members-page">
    <div className="page-heading"><div>
      <span className="eyebrow">GUILD MASTER</span>
      <h1>{t("members.title")} {data && <span className="muted members-total">({data.members.length})</span>}</h1>
      <p>{t("members.intro")}</p>
    </div></div>
    {error && <p className="library-error" role="alert">{t(error)} <button className="text-button" onClick={() => save(async () => {})}>{t("common:actions.retry")}</button></p>}
    {saved && <p className="members-saved" role="status">{t("members.saved")}</p>}
    {!data && !error && <p className="muted" role="status">{t("members.loading")}</p>}
    {data && <div className="members-layout">
      <dialog ref={rolesDialog} className="roles-drawer" aria-labelledby="roles-title" onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) rolesDialog.current.close();
      }}>
        <div className="roles-drawer-heading">
          <h2 id="roles-title">{t("members.roles")} <span className="muted">({data.roles.length})</span></h2>
          <button type="button" className="icon-button" autoFocus aria-label={t("members.closeRoles")} onClick={() => rolesDialog.current.close()}><Icon name="close" /></button>
        </div>
        <div className="roles-content">
          {error && <p className="library-error" role="alert">{t(error)}</p>}
          {saved && <p className="members-saved" role="status">{t("members.saved")}</p>}

        <p>{t("members.roleHint")}</p>
        <div className="roles-list-toolbar">
          <button className="button primary" type="button" disabled={busy || (role !== null && !role.id)} onClick={() => { setRole({ ...emptyRole }); setError(""); setSaved(false); }}><Icon name="plus" size={16} />{t("members.newRole")}</button>
        </div>
        {role && !role.id && <section className="new-role-panel" aria-label={t("members.newRole")}>{renderRoleForm()}</section>}
        <table className="roles-table">
          <thead><tr><th scope="col">{t("members.roleName")}</th><th scope="col" className="role-row-actions">{t("members.roleActions")}</th></tr></thead>
          <tbody>{data.roles.map((item) => {
            const expanded = role?.id === item.id;
            const name = item.isDefault ? t("members.defaultRole") : item.name;
            return <Fragment key={item.id}>
              <tr className={expanded ? "role-row is-expanded" : "role-row"}>
                <th scope="row">{name}</th>
                <td className="role-row-actions"><button type="button" className={`icon-button${expanded ? " is-active" : ""}`} disabled={busy} aria-label={t(expanded ? "members.collapseRole" : "members.viewRole", { name })} title={t(expanded ? "members.collapseRole" : "members.viewRole", { name })} aria-expanded={expanded} aria-controls={`role-editor-${item.id}`} onClick={() => { setRole(expanded ? null : { ...item }); setError(""); setSaved(false); }}><Icon name="eye" /></button></td>
              </tr>
              <tr className="role-editor-row" hidden={!expanded}><td colSpan={2}><div id={`role-editor-${item.id}`} className="role-editor">{expanded && renderRoleForm()}</div></td></tr>
            </Fragment>;
          })}</tbody>
        </table>
        </div>
      </dialog>
      <section className="library-panel members-list">
        <div className="members-toolbar">
        <input className="members-search" aria-label={t("members.search")} placeholder={t("members.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="button" className="button members-roles-button" aria-haspopup="dialog" onClick={() => rolesDialog.current.showModal()}>{t("members.viewRoles")} <span className="muted">({data.roles.length})</span></button>
        </div>
        {data.members.filter((member) => [member.name, member.discordUsername || '', member.discordId || ''].some((value) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).map((member) => <article className="member-card" key={member.id}>
          <div className="member-heading"><div className="member-identity"><MemberAvatar member={member} /><div>
            <strong>{member.name}</strong>
            <span className="member-discord-name" title={member.discordId ? `Discord ID: ${member.discordId}` : undefined}>{member.discordUsername ? `@${member.discordUsername}` : t('members.localAccount')}</span>
          </div></div>
            <div className="member-statuses">
            {member.isGuildMaster && <span className="member-badge">Guild Master</span>}
            {member.pendingApproval && <span className="member-badge">{t("members.pendingBadge")}</span>}
            {member.manuallyApproved && <div className="member-approval">
              <span className="member-badge">{t("members.manualBadge")}</span>
              {!member.isProtected && <button type="button" className="button member-revoke" disabled={busy} onClick={() => {
                if (window.confirm(t("members.revokeConfirm", { name: member.name }))) save(() => apiRequest(`/api/members/${member.id}/approval/`, { method: "PUT", body: { approved: false } }));
              }}>{t("members.revoke")}</button>}
            </div>}
            {!member.isActive && <span className="muted">{t("members.inactive")}</span>}
            </div>
          </div>
          <dl className="member-details">
            <div><dt>{t('members.joinedAt')}</dt><dd>{member.joinedAt ? <time dateTime={member.joinedAt} title={new Date(member.joinedAt).toLocaleString(i18n.resolvedLanguage)}>{new Date(member.joinedAt).toLocaleDateString(i18n.resolvedLanguage, { day: 'numeric', month: 'short', year: 'numeric' })}</time> : t('members.unknownDate')}</dd></div>
            <div><dt>{t('members.lastAccess')}</dt><dd>{member.lastAccessAt ? <time dateTime={member.lastAccessAt}>{new Date(member.lastAccessAt).toLocaleString(i18n.resolvedLanguage, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time> : t('members.accessNotRecorded')}</dd></div>
          </dl>
          {member.isProtected ? <p className="muted">{t("members.protected")}</p> : member.pendingApproval ? <>
            <p className="muted">{t("members.pendingMemberHint")}</p>
            <button className="button primary" disabled={busy} onClick={() => save(() => apiRequest(`/api/members/${member.id}/approval/`, { method: "PUT", body: { approved: true } }))}>{t("members.approve")}</button>
          </> : <>
            <div className="member-role-options">{data.roles.map((item) => <Switch key={item.id}
              disabled={busy || member.automaticRoleIds?.includes(item.id)} checked={member.roleIds.includes(item.id)} onChange={(event) => {
                const roleIds = event.target.checked ? [...member.roleIds, item.id] : member.roleIds.filter((id) => id !== item.id);
                save(() => apiRequest(`/api/members/${member.id}/roles/`, { method: "PUT", body: { roleIds } }));
              }} label={<>{item.isDefault ? t("members.defaultRole") : item.name}
                {member.automaticRoleIds?.includes(item.id) && <small className="automatic-role-source">Discord</small>}
              </>} />)}</div>
          </>}
        </article>)}
      </section>

    </div>}
  </main>;
}
