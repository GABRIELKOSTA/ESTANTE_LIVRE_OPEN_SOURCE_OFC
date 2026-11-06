import { useEffect, useMemo, useRef, useState } from 'react';
import Cover from './Cover.jsx';
import { Icon } from './Icons.jsx';

export const fold = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function Search({ books, collections, onPick, onClose }) {
  const [q, setQ] = useState('');
  const input = useRef(null);
  useEffect(() => { setTimeout(() => input.current?.focus(), 60); }, []);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  const colName = (id) => collections.find((c) => c.id === id)?.name;
  const results = useMemo(() => {
    const t = fold(q.trim());
    const list = t ? books.filter((b) => fold(`${b.title} ${b.author} ${colName(b.collectionId) || ''}`).includes(t)) : [...books].sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
    return list.slice(0, 60);
  }, [q, books]);
  return (
    <div className="search-layer">
      <div className="search-bar">
        <Icon name="search" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título, autor ou coletânea" onKeyDown={(e) => e.key === 'Enter' && results[0] && onPick(results[0])} />
        <button className="icon-btn" onClick={onClose} aria-label="Fechar busca"><Icon name="close" /></button>
      </div>
      <p className="search-hint">{q ? `${results.length} resultado(s)` : 'Recentes'}</p>
      <div className="search-grid">
        {results.map((b, i) => (
          <button key={b.id} className="search-card" style={{ animationDelay: Math.min(i, 12) * 25 + 'ms' }} onClick={() => onPick(b)}>
            <Cover book={b} />
            <span className="sc-title">{b.title}</span>
            <span className="sc-author">{b.author}</span>
          </button>
        ))}
        {!results.length && <p className="muted">Nada encontrado na sua estante. Procure em “Descobrir livros”.</p>}
      </div>
    </div>
  );
}
