import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage, savedLanguage } from './i18n';
import { Icon } from './icons';

const languages = [
  { code: 'pt-BR', name: 'Português (Brasil)', short: 'PT-BR' },
  { code: 'en-US', name: 'English (US)', short: 'EN-US' },
  { code: 'es', name: 'Español', short: 'ES' },
];

export function FirstVisitLanguage() {
  const { t, i18n } = useTranslation('common');
  const [visible, setVisible] = useState(() => !savedLanguage());
  const [selected, setSelected] = useState(i18n.resolvedLanguage);
  const dialog = useRef(null);
  useEffect(() => {
    if (visible && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      dialog.current.querySelector('input:checked')?.focus();
    }
  }, [visible]);
  function confirm() {
    changeLanguage(selected);
    setVisible(false);
  }
  if (!visible) return null;
  return <dialog ref={dialog} className="language-welcome" aria-labelledby="language-welcome-title" aria-describedby="language-welcome-hint" onCancel={(event) => { event.preventDefault(); confirm(); }}>
    <span className="language-welcome-icon" aria-hidden="true"><Icon name="globe" size={24} /></span>
    <h2 id="language-welcome-title">{t('languageWelcome.title')}</h2>
    <p id="language-welcome-hint">{t('languageWelcome.hint')}</p>
    <div className="language-choices" role="radiogroup" aria-label={t('language')}>
      {languages.map(({ code, name, short }) => <label key={code} className={`language-choice${selected === code ? ' is-selected' : ''}`}>
        <input type="radio" name="welcome-language" value={code} checked={selected === code} onChange={() => { setSelected(code); i18n.changeLanguage(code); }} />
        <strong>{name}</strong><span>{short}</span>
      </label>)}
    </div>
    <button type="button" className="button primary language-continue" onClick={confirm}>{t('languageWelcome.continue')}</button>
  </dialog>;
}
