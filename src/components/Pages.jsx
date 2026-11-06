import { useState } from 'react';
import Cover from './Cover.jsx';
import { Icon } from './Icons.jsx';
import { COLORS } from './Sheets.jsx';

export function PageHeader({ title, onBack, children }) {
  return (
    <header className="page-head">
      <button className="icon-btn" onClick={onBack} aria-label="Voltar"><Icon name="back" /></button>
      <h2>{title}</h2>
      <div className="ph-extra">{children}</div>
    </header>
  );
}

// ---------- Organizar estante
export function Organize({ books, collections, onSave, onBack, onEditCollection }) {
  const top = () => [
    ...collections.map((c) => ({ key: 'c' + c.id, type: 'col', ref: c, order: c.order })),
    ...books.filter((b) => !b.collectionId).map((b) => ({ key: 'b' + b.id, type: 'book', ref: b, order: b.order })),
  ].sort((a, b) => a.order - b.order);
  const [list, setList] = useState(top);
  const [inner, setInner] = useState(() => Object.fromEntries(collections.map((c) => [c.id, books.filter((b) => b.collectionId === c.id).sort((a, b) => a.collOrder - b.collOrder)])));
  const [open, setOpen] = useState(null);
  const [dirty, setDirty] = useState(false);

  const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const n = [...arr]; [n[i], n[j]] = [n[j], n[i]]; return n; };
  const sortBy = (fn) => { setList((l) => [...l].sort(fn)); setDirty(true); };
  const nameOf = (e) => (e.type === 'col' ? e.ref.name : e.ref.title).toLowerCase();

  const save = () => {
    const outBooks = []; const outCols = [];
    list.forEach((e, i) => {
      if (e.type === 'col') outCols.push({ ...e.ref, order: i + 1 });
      else outBooks.push({ ...e.ref, order: i + 1 });
    });
    Object.values(inner).forEach((arr) => arr.forEach((b, i) => outBooks.push({ ...b, collOrder: i })));
    onSave(outBooks, outCols);
    setDirty(false);
  };

  return (
    <div className="page">
      <PageHeader title="Organizar estante" onBack={onBack}>
        <button className="xbtn primary sm" disabled={!dirty} onClick={save}>Salvar ordem</button>
      </PageHeader>
      <div className="chips">
        <span className="muted">Ordenar:</span>
        <button className="chip" onClick={() => sortBy((a, b) => nameOf(a).localeCompare(nameOf(b)))}>A–Z</button>
        <button className="chip" onClick={() => sortBy((a, b) => (a.type === 'col' ? '' : a.ref.author || '~').localeCompare(b.type === 'col' ? '' : b.ref.author || '~'))}>Autor</button>
        <button className="chip" onClick={() => sortBy((a, b) => (b.ref.openedAt || b.ref.createdAt || 0) - (a.ref.openedAt || a.ref.createdAt || 0))}>Recentes</button>
        <button className="chip" onClick={() => sortBy((a, b) => (a.type === 'col' ? -1 : 0) - (b.type === 'col' ? -1 : 0))}>Coletâneas primeiro</button>
      </div>
      <ol className="org-list">
        {list.map((e, i) => (
          <li key={e.key} className={'org-row' + (e.type === 'col' ? ' is-col' : '')}>
            <div className="org-main">
              <span className="org-n">{i + 1}</span>
              {e.type === 'col'
                ? <span className="org-box" style={{ '--c': e.ref.color }}><Icon name="layers" size={18} /></span>
                : <span className="org-thumb"><Cover book={e.ref} /></span>}
              <button className="org-name" onClick={() => e.type === 'col' && setOpen(open === e.ref.id ? null : e.ref.id)}>
                <strong>{e.type === 'col' ? e.ref.name : e.ref.title}</strong>
                <small>{e.type === 'col' ? `Coletânea · ${(inner[e.ref.id] || []).length} livros · toque para ordenar` : e.ref.author}</small>
              </button>
              <div className="org-btns">
                {e.type === 'col' && <button className="icon-btn" aria-label="Editar coletânea" onClick={() => onEditCollection(e.ref)}><Icon name="edit" size={18} /></button>}
                <button className="icon-btn" aria-label="Subir" onClick={() => { setList((l) => move(l, i, -1)); setDirty(true); }}><Icon name="up" size={18} /></button>
                <button className="icon-btn" aria-label="Descer" onClick={() => { setList((l) => move(l, i, 1)); setDirty(true); }}><Icon name="down" size={18} /></button>
              </div>
            </div>
            {e.type === 'col' && open === e.ref.id && (
              <ol className="org-inner">
                {(inner[e.ref.id] || []).map((b, j) => (
                  <li key={b.id}>
                    <span className="org-thumb sm"><Cover book={b} /></span>
                    <span className="org-inner-name">{b.title}</span>
                    <button className="icon-btn" aria-label="Subir" onClick={() => { setInner((m) => ({ ...m, [e.ref.id]: move(m[e.ref.id], j, -1) })); setDirty(true); }}><Icon name="up" size={16} /></button>
                    <button className="icon-btn" aria-label="Descer" onClick={() => { setInner((m) => ({ ...m, [e.ref.id]: move(m[e.ref.id], j, 1) })); setDirty(true); }}><Icon name="down" size={16} /></button>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
        {!list.length && <p className="muted pad">A estante está vazia.</p>}
      </ol>
    </div>
  );
}

// ---------- Personalizar
const ACCENTS = [
  { id: 'rgb', label: 'RGB animado' },
  { id: 'single', label: 'Cor única' },
];
const SHELVES = [
  { id: 'madeira', label: 'Madeira' },
  { id: 'vidro', label: 'Vidro fosco' },
  { id: 'neon', label: 'Neon' },
  { id: 'metal', label: 'Metal escuro' },
];
export function Settings({ ui, setUi, onBack, stats }) {
  const set = (k, v) => setUi({ ...ui, [k]: v });
  return (
    <div className="page">
      <PageHeader title="Personalizar" onBack={onBack} />
      <section className="set-group">
        <h4>Iluminação</h4>
        <div className="seg">
          {ACCENTS.map((a) => <button key={a.id} className={ui.accentMode === a.id ? 'on' : ''} onClick={() => set('accentMode', a.id)}>{a.label}</button>)}
        </div>
        {ui.accentMode === 'single' && (
          <div className="swatches">{COLORS.slice(0, 8).map((c) => <button key={c} className={'swatch' + (ui.accent === c ? ' on' : '')} style={{ '--c': c }} onClick={() => set('accent', c)} aria-label={c} />)}</div>
        )}
        <label className="range"><span>Velocidade do RGB</span>
          <input type="range" min="2" max="16" step="1" value={ui.rgbSpeed} onChange={(e) => set('rgbSpeed', +e.target.value)} /><b>{ui.rgbSpeed}s</b></label>
        <label className="range"><span>Brilho do fundo</span>
          <input type="range" min="0" max="100" value={ui.glow} onChange={(e) => set('glow', +e.target.value)} /><b>{ui.glow}%</b></label>
      </section>
      <section className="set-group">
        <h4>Estante</h4>
        <div className="seg">{SHELVES.map((s) => <button key={s.id} className={ui.shelf === s.id ? 'on' : ''} onClick={() => set('shelf', s.id)}>{s.label}</button>)}</div>
        <label className="toggle"><input type="checkbox" checked={ui.showHints} onChange={(e) => set('showHints', e.target.checked)} /><span>Mostrar atalhos de teclado (desktop)</span></label>
      </section>
      <section className="set-group">
        <h4>Animações</h4>
        <label className="toggle"><input type="checkbox" checked={ui.openAnim} onChange={(e) => set('openAnim', e.target.checked)} /><span>Livro abrindo ao começar a ler</span></label>
        <label className="toggle"><input type="checkbox" checked={ui.flipAnim} onChange={(e) => set('flipAnim', e.target.checked)} /><span>Folha virando ao passar página</span></label>
        <label className="range"><span>Duração da folha</span>
          <input type="range" min="300" max="1200" step="50" value={ui.flipMs} onChange={(e) => set('flipMs', +e.target.value)} /><b>{ui.flipMs}ms</b></label>
      </section>
      <section className="set-group">
        <h4>Armazenamento</h4>
        <p className="muted">{stats.count} livros · {(stats.bytes / 1048576).toFixed(1)} MB guardados neste aparelho. Tudo fica offline, sem conta e sem nuvem.</p>
      </section>
    </div>
  );
}
