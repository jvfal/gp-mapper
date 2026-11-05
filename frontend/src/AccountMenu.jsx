import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Icon } from './icons';

export function DiscordStatus({ user }) {
  const { t } = useTranslation('mapper');
  if (!user?.discordNeedsRefresh) return null;
  const content = <><span className="discord-status-dot" aria-hidden="true" /><span>{t('auth.discordNeedsRefresh')}</span><strong>{t('auth.reconnectDiscord')}</strong></>;
  const title = t(user.discordLoginAvailable ? 'auth.discordRefreshHint' : 'auth.unavailable');
  return user.discordLoginAvailable
    ? <a className="discord-refresh-status" title={title} href={`/auth/discord/login/?next=${encodeURIComponent(location.pathname + location.search)}`}>{content}</a>
    : <span className="discord-refresh-status" title={title}>{content}</span>;
}

export function AccountMenu({ user }) {
  const { t } = useTranslation('mapper');
  const menu = useRef(null);
  useEffect(() => {
    const outside = (event) => { if (menu.current && !menu.current.contains(event.target)) menu.current.open = false; };
    const escape = (event) => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  return <details ref={menu} className="account-menu">
    <summary className="account-trigger" aria-label={user ? t('auth.accountMenu', { name: user.name }) : t('common:language')} title={user ? user.name : t('common:language')}>
      {user?.avatarUrl ? <img src={user.avatarUrl} alt="" width="28" height="28" /> : <Icon name={user ? 'user' : 'globe'} size={18} />}
      {user && <span className="account-name">{user.name}</span>}
      {user && <Icon name="chevron" size={13} />}
    </summary>
    <div className="account-dropdown">
      {user && <strong className="account-dropdown-name">{user.name}</strong>}
      <label className="account-language"><span><Icon name="globe" size={14} />{t('common:language')}</span><LanguageSwitcher /></label>
      {user && <form method="post" action="/auth/logout/">
        <input type="hidden" name="csrfmiddlewaretoken" value={document.getElementById('mapper-root').dataset.csrfToken} />
        <button className="account-signout" type="submit">{t('auth.signOut')}</button>
      </form>}
    </div>
  </details>;
}
