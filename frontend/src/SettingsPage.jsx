import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiRequest } from "./boardApi";
import { guildName, GuildIcon } from "./Brand";
import { Icon } from "./icons";
import { Switch } from "./Switch";

export function SettingsPage({ onChanged }) {
  const { t } = useTranslation("mapper");
  const [module, setModule] = useState(null);
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem('gp-mapper:mapper-settings') !== 'collapsed'; }
    catch { return true; }
  });
  const optionsOpen = Boolean(module?.enabled && expanded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [savedChannel, setSavedChannel] = useState('');
  const [channelConfirm, setChannelConfirm] = useState(false);
  const [channelError, setChannelError] = useState('');
  const [channelErrorParams, setChannelErrorParams] = useState({});
  const [channelConfigured, setChannelConfigured] = useState('');
  const [channelTarget, setChannelTarget] = useState(null);
  const channelDialog = useRef(null);
  const cancelChannel = useRef(null);
  const [branding, setBranding] = useState(null);
  const [iconBlob, setIconBlob] = useState(null);
  const [iconPreview, setIconPreview] = useState("");
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState(false);
  const [iconSaved, setIconSaved] = useState(false);
  const iconInput = useRef(null);
  const [pendingToggle, setPendingToggle] = useState(null);
  const toggleDialog = useRef(null);
  const cancelToggle = useRef(null);

  useEffect(() => {
    if (channelConfirm) {
      channelDialog.current.showModal();
      cancelChannel.current.focus();
    } else if (channelDialog.current?.open) channelDialog.current.close();
  }, [channelConfirm]);

  useEffect(() => {
    if (pendingToggle !== null) {
      toggleDialog.current.showModal();
      cancelToggle.current.focus();
    } else if (toggleDialog.current?.open) {
      toggleDialog.current.close();
    }
  }, [pendingToggle]);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/api/settings/', { signal: controller.signal }).then((result) => {
      setModule(result.modules.find((item) => item.code === 'mapper'));
      setSavedChannel(result.modules.find((item) => item.code === 'mapper')?.settings.discordChannelId || '');
      setBranding(result.branding);
    }).catch((error) => {
      if (error.name !== 'AbortError') setError('modules.loadError');
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const interval = setInterval(() => {
      apiRequest('/api/settings/', { signal: controller.signal }).then((result) => {
        const current = result.modules.find((item) => item.code === 'mapper');
        setModule((previous) => previous && current ? { ...previous, botStatus: current.botStatus, botAvailable: current.botAvailable,
          ...(previous.settings.discordChannelId === current.settings.discordChannelId ? { discordChannel: current.discordChannel } : {}),
        } : previous);
      }).catch(() => {});
    }, 15000);
    return () => { clearInterval(interval); controller.abort(); };
  }, []);

  useEffect(() => () => { if (iconPreview) URL.revokeObjectURL(iconPreview); }, [iconPreview]);

  async function chooseIcon(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIconBusy(true); setIconError(false); setIconSaved(false);
    setIconBlob(null); setIconPreview('');
    let bitmap;
    try {
      if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('invalid_icon');
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob || blob.size > 512 * 1024) throw new Error('invalid_icon');
      setIconBlob(blob); setIconPreview(URL.createObjectURL(blob));
    } catch { setIconError(true); }
    finally { bitmap?.close(); setIconBusy(false); }
  }

  async function saveIcon(remove = false) {
    if (iconBusy || (!remove && !iconBlob)) return;
    setIconBusy(true); setIconError(false); setIconSaved(false);
    try {
      const form = new FormData();
      if (!remove) form.append('icon', iconBlob, 'guild-icon.png');
      const result = await apiRequest('/api/settings/branding/', { method: remove ? 'DELETE' : 'POST', body: remove ? undefined : form });
      setBranding(result.branding); setIconBlob(null); setIconPreview('');
      await onChanged(); setIconSaved(true);
    } catch { setIconError(true); }
    finally { setIconBusy(false); }
  }

  function changeExpansion(value) {
    setExpanded(value);
    try { localStorage.setItem('gp-mapper:mapper-settings', value ? 'expanded' : 'collapsed'); }
    catch { /* The accordion still works when storage is unavailable. */ }
  }
  function changeSettings(changes) {
    setSaved(false);
    if ('discordChannelId' in changes) { setChannelConfigured(''); setChannelError(''); }
    setModule((current) => ({ ...current, settings: { ...current.settings, ...changes } }));
  }
  async function toggleModule(enabled) {
    if (busy) return;
    const previous = module.enabled;
    setBusy(true); setError(''); setSaved(false);
    setModule((current) => ({ ...current, enabled }));
    try {
      await apiRequest('/api/settings/modules/mapper/', { method: 'PATCH', body: { enabled } });
      if (enabled) changeExpansion(true);
      await onChanged();
    } catch {
      setModule((current) => ({ ...current, enabled: previous }));
      setError('modules.saveError');
    } finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const result = await apiRequest('/api/settings/modules/mapper/', { method: 'PUT', body: module });
      setModule(result.module);
      setSavedChannel(result.module.settings.discordChannelId);
      await onChanged();
      setSaved(true);
    } catch (error) {
      setError(error.code === 'invalid_channel' ? 'modules.invalidChannel' : 'modules.saveError');
    } finally { setBusy(false); }
  }

  function channelFailure(error) {
    setChannelErrorParams({ permissions: (error.missingPermissions || []).map((name) => t(`modules.discordPermissionNames.${name}`)).join(', ') });
    const messages = { missing_permissions: 'modules.channelOperationDenied', bot_permissions_not_installed: 'modules.botPermissionsNotInstalled', bot_thread_permissions_required: 'modules.botThreadPermissionsRequired', channel_permissions_blocked: 'modules.channelPermissionsBlocked', member_role_not_found: 'modules.memberRoleMissing', invalid_discord_configuration: 'modules.discordConfigMissing', channel_changed: 'modules.channelSaveFirst' };
    const botErrors = ['missing_token', 'wrong_guild', 'invalid_channel_type', 'invalid_token', 'channel_not_found', 'rate_limited', 'connection_error', 'certificate_error', 'discord_error', 'missing_access', 'discord_forbidden'];
    return messages[error.code] || (botErrors.includes(error.code) ? `modules.botStatus.${error.code}` : 'modules.channelSetupError');
  }
  async function openChannelSetup() {
    if (busy) return;
    setBusy(true); setChannelError('');
    try {
      const result = await apiRequest('/api/settings/modules/mapper/discord-channel/');
      if (result.channelId !== savedChannel) { setChannelError('modules.channelSaveFirst'); return; }
      setChannelTarget(result);
      setModule((current) => ({ ...current, discordChannel: { name: result.channelName, configured: result.configured } }));
      setChannelConfirm(true);
    } catch (error) { setChannelError(channelFailure(error)); }
    finally { setBusy(false); }
  }
  async function setupChannel() {
    if (busy) return;
    setBusy(true); setChannelError(''); setChannelConfigured('');
    try {
      const result = await apiRequest('/api/settings/modules/mapper/discord-channel/', { method: 'POST', body: { confirmed: true, channelId: channelTarget.channelId } });
      setChannelConfigured(result.channelName);
      setChannelConfirm(false);
      setModule((current) => ({ ...current, botAvailable: false, botStatus: 'checking', discordChannel: { name: result.channelName, configured: true } }));
    } catch (error) {
      setChannelError(channelFailure(error));
    } finally { setBusy(false); }
  }

  return <main className="board-library settings-page">
    <dialog ref={channelDialog} className="module-confirm-dialog" role="alertdialog" aria-labelledby="channel-confirm-title" aria-describedby="channel-confirm-hint" onCancel={(event) => { if (busy) event.preventDefault(); else setChannelConfirm(false); }} onClick={(event) => {
      if (busy || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setChannelConfirm(false);
    }}>
      <h2 id="channel-confirm-title">{t('modules.channelConfirmTitle')}</h2>
      <p id="channel-confirm-hint">{t('modules.channelConfirmHint', { channel: channelTarget?.channelName || '' })}</p>
      <p>{t('modules.channelConfirmImpact')}</p>
      {channelError && <p className="library-error" role="alert">{t(channelError, channelErrorParams)}</p>}
      <div className="module-confirm-actions">
        <button ref={cancelChannel} type="button" className="button secondary" disabled={busy} onClick={() => setChannelConfirm(false)}>{t('common:actions.cancel')}</button>
        <button type="button" className="button primary" disabled={busy} onClick={setupChannel}>{t(busy ? 'modules.channelConfiguring' : channelTarget?.configured ? 'modules.reconfigureChannel' : 'modules.configureChannel')}</button>
      </div>
    </dialog>
    <dialog ref={toggleDialog} className="module-confirm-dialog" role="alertdialog" aria-labelledby="module-confirm-title" aria-describedby="module-confirm-description" onCancel={() => setPendingToggle(null)} onClick={(event) => {
      if (event.target === event.currentTarget) setPendingToggle(null);
    }}>
      <h2 id="module-confirm-title">{t(pendingToggle ? 'modules.confirmEnableTitle' : 'modules.confirmDisableTitle', { module: t('page.product') })}</h2>
      <p id="module-confirm-description">{t(pendingToggle ? 'modules.confirmEnableHint' : 'modules.confirmDisableHint')}</p>
      <div className="module-confirm-actions">
        <button ref={cancelToggle} type="button" className="button secondary" onClick={() => setPendingToggle(null)}>{t('common:actions.cancel')}</button>
        <button type="button" className={`button primary${pendingToggle === false ? ' confirm-disable' : ''}`} onClick={() => {
          const enabled = pendingToggle;
          setPendingToggle(null);
          if (enabled !== null) toggleModule(enabled);
        }}>{t(pendingToggle ? 'modules.confirmEnable' : 'modules.confirmDisable')}</button>
      </div>
    </dialog>
    <div className="page-heading"><div>
      <span className="eyebrow">{guildName()}</span>
      <h1>{t('modules.title')}</h1>
      <p>{t('modules.intro')}</p>
    </div></div>
    {error && <p className="library-error" role="alert">{t(error)}</p>}
    {branding && <section className="library-panel branding-panel">
      <h2>{t('branding.title')}</h2>
      <p>{t('branding.hint')}</p>
      <div className="branding-preview"><GuildIcon url={iconPreview || branding.iconUrl} /><strong>{guildName()}</strong></div>
      <input ref={iconInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={chooseIcon} />
      <div className="role-actions">
        <button className="button secondary" disabled={iconBusy} onClick={() => iconInput.current.click()}>{t('branding.choose')}</button>
        <button className="button primary" disabled={iconBusy || !iconBlob} onClick={() => saveIcon()}>{t('branding.save')}</button>
        {branding.iconUrl && <button className="text-button" disabled={iconBusy} onClick={() => saveIcon(true)}>{t('branding.restore')}</button>}
      </div>
      {iconError && <p className="library-error" role="alert">{t('branding.error')}</p>}
      {iconSaved && <p className="members-saved" role="status">{t('branding.saved')}</p>}
    </section>}
    {!module && !error && <p className="muted" role="status">{t('modules.loading')}</p>}
    {module && <section className={`library-panel module-panel${module.enabled ? " module-can-collapse" : " module-off"}`} onClick={(event) => {
      if (!module.enabled || busy || event.target.closest('.module-toggle, .module-parameters, button, input, select, label, a')) return;
      changeExpansion(!expanded);
    }}>
      <form onSubmit={save}>
        <div className="module-heading">
          <span className="module-icon"><Icon name="compass" size={28} /></span>
          <div><h2>{t('page.product')}</h2><p>{t('modules.mapperDescription')}</p></div>
          <Switch className="module-toggle" label={t('modules.enabled')} controls="mapper-module-options"
            checked={module.enabled} disabled={busy} onChange={(event) => setPendingToggle(event.target.checked)} />
          <button type="button" className={`icon-button module-collapse${optionsOpen ? ' is-open' : ''}`} aria-expanded={optionsOpen} aria-controls="mapper-module-options" aria-label={t(optionsOpen ? 'modules.collapseOptions' : 'modules.expandOptions', { module: t('page.product') })} title={t(optionsOpen ? 'modules.collapseOptions' : 'modules.expandOptions', { module: t('page.product') })} disabled={busy || !module.enabled} onClick={() => changeExpansion(!expanded)}><Icon name="chevron" size={20} /></button>
        </div>
        {(optionsOpen || !module.enabled) && <p className="module-preservation muted">{t('modules.preservationHint')}</p>}
        <div className={`module-parameters${optionsOpen ? " is-open" : ""}`} id="mapper-module-options" aria-hidden={!optionsOpen} inert={!optionsOpen}>
          <div className="module-parameters-inner">
        <fieldset className="module-options" disabled={busy || !optionsOpen}>
          <div className="discord-notification-heading">
            <div><h3>{t('modules.discordTitle')}</h3>{module.discordChannel?.name && <span className="discord-channel-name">#{module.discordChannel.name}</span>}</div>
            <div className="discord-notification-controls">
              <span className={`member-badge${module.botAvailable ? ' bot-ready' : ''}`}>{t(`modules.botStatus.${module.botStatus || 'checking'}`)}</span>
              <button type="button" className="button secondary" disabled={busy || !savedChannel || module.settings.discordChannelId !== savedChannel} onClick={openChannelSetup}>{t(module.discordChannel?.configured ? 'modules.reconfigureChannel' : 'modules.configureChannel')}</button>
            </div>
          </div>
          <p className="module-bot-hint">{t('modules.botHint')}</p>
          <div className="module-fields">
            <label className="board-name-label">{t('modules.channelId')}
              <input inputMode="numeric" pattern="[0-9]{1,20}" maxLength={20} value={module.settings.discordChannelId} disabled={busy} placeholder="123456789012345678" onChange={(event) => changeSettings({ discordChannelId: event.target.value })} />
            </label>
            <label className="board-name-label">{t('modules.warningMinutes')}
              <input type="number" min="1" max="120" required value={module.settings.warningMinutes} disabled={busy} onChange={(event) => changeSettings({ warningMinutes: Number(event.target.value) })} />
            </label>
          </div>
          <p className="muted">{t('modules.channelHint')}</p>
          <div className="channel-setup-feedback">
            <p className="muted">{t(module.settings.discordChannelId !== savedChannel || !savedChannel ? 'modules.channelSaveFirst' : 'modules.channelSetupHint')}</p>
            {channelError && !channelConfirm && <p className="library-error" role="alert">{t(channelError, channelErrorParams)}</p>}
            {channelConfigured && <p className="module-saved-status" role="status">{t('modules.channelConfigured', { name: channelConfigured })}</p>}
          </div>
          <div className="module-save-actions">
            <button className="button primary" disabled={busy}>{t(busy ? 'modules.saving' : 'modules.save')}</button>
            {saved && <span className="module-saved-status" role="status">{t('modules.saved')}</span>}
          </div>
        </fieldset>
          </div>
        </div>
      </form>
    </section>}
  </main>;
}
