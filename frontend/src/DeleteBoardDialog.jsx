import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { boardApi } from './boardApi';
import { Icon } from './icons';

export function DeleteBoardDialog({ board, onClose, onDeleted }) {
  const { t } = useTranslation('mapper');
  const dialog = useRef(null);
  const cancel = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current.showModal();
    cancel.current.focus();
  }, []);
  async function remove() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await boardApi(`${board.id}/`, { method: 'DELETE' });
      onDeleted(board.id);
    } catch (error) {
      // Another collaborator may already have removed this map.
      if (error.status === 404) onDeleted(board.id);
      else setError(error.status === 403 ? 'library.deleteDenied' : 'library.deleteError');
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="delete-board-dialog" aria-labelledby="delete-board-title" aria-describedby="delete-board-hint" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} onClick={(event) => {
    if (busy || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <h2 id="delete-board-title">{t('library.deleteTitle', { name: board.name })}</h2>
    <p id="delete-board-hint">{t('library.deleteHint')}</p>
    {error && <p className="library-error" role="alert">{t(error)}</p>}
    <div className="delete-board-actions">
      <button ref={cancel} className="button secondary" disabled={busy} onClick={onClose}>{t('common:actions.cancel')}</button>
      <button className="button delete-board-confirm" disabled={busy} onClick={remove}><Icon name="trash" size={15} />{t(busy ? 'library.deleting' : 'library.delete')}</button>
    </div>
  </dialog>;
}
