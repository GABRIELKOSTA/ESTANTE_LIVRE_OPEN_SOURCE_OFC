import { useEffect, useRef, useState } from 'react';
import Cover from './Cover.jsx';
import { Icon } from './Icons.jsx';
import { shrinkImage, dominantColor, hashColor, isComic } from '../lib/library.js';
import WifiShare from './WifiShare.jsx';
import { canShareWifi } from '../lib/wifi-share.js';

export const COLORS = ['#ff2d75', '#ff7a1a', '#ffd23f', '#38e07b', '#19e3ff', '#3d7bff', '#7a5cff', '#c04dff', '#8a6a4a', '#5b6474'];

export function Sheet({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'sheet' + (wide ? ' wide' : '')} ref={ref} role="dialog" aria-label={title}>
        <div className="sheet-grip" />
        <header className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function BookSheet({ book, collections, onSave, onDelete, onClose, onRead }) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [col, setCol] = useState(book.collectionId || '');
  const [language, setLanguage] = useState(book.language || '');
  const [confirm, setConfirm] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [cover, setCover] = useState({ blob: book.cover, color: book.color });
  const pick = useRef(null);
  const draft = { ...book, cover: cover.blob, color: cover.color };
  const save = () => { onSave({ ...draft, title: title.trim() || book.title, author: author.trim(), collectionId: col || null, language }); onClose(); };
  const onPickCover = async (f) => {
    if (!f || !f.type.startsWith('image')) return;
    const blob = await shrinkImage(f);
    setCover({ blob, color: (await dominantColor(blob)) || book.color });
  };
  const mb = (book.size / 1048576).toFixed(1);
  const comic = isComic(book.format);
  if (sharing) return <WifiShare book={book} onClose={onClose} onBack={() => setSharing(false)} />;
  return (
    <Sheet title={comic ? 'Detalhes da HQ' : 'Detalhes do livro'} onClose={onClose}>
      <div className="bs-top">
        <div className="bs-cover-wrap">
          <button className="bs-cover" onClick={() => pick.current?.click()} aria-label="Trocar capa">
            <Cover book={draft} />
            <span className="bs-cover-edit"><Icon name="edit" size={16} /></span>
          </button>
          <button className="xbtn sm ghost" onClick={() => pick.current?.click()}>Trocar capa</button>
          {cover.blob && <button className="link-btn" onClick={() => setCover({ blob: null, color: hashColor(book.title) })}>Usar capa gerada</button>}
          <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { onPickCover(e.target.files[0]); e.target.value = ''; }} />
        </div>
        <div className="bs-facts">
          <span className="tag">{comic ? 'HQ · ' : ''}{book.format.toUpperCase()}</span>
          <p>{mb} MB · {Math.round((book.progress || 0) * 100)}% lido</p>
          <p>Adicionado em {new Date(book.addedAt).toLocaleDateString('pt-BR')}</p>
          {book.bookmarks?.length > 0 && <p>{book.bookmarks.length} marcador(es)</p>}
          <button className="xbtn primary sm" onClick={() => { onClose(); onRead(); }}>Ler agora</button>
          {canShareWifi() && <button className="xbtn sm" onClick={() => setSharing(true)}><Icon name="qr" size={18} />Compartilhar por Wi-Fi</button>}
        </div>
      </div>
      <label className="field"><span>Título</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span>Autor</span><input value={author} onChange={(e) => setAuthor(e.target.value)} /></label>
      <div className="field"><span>Idioma</span>
        <div className="seg small">
          {[['pt', 'PT-BR'], ['en', 'Inglês'], ['es', 'Espanhol'], ['', 'Outro / ?']].map(([k, l]) => (
            <button key={k || 'x'} className={(language === k || (k === '' && !['pt', 'en', 'es'].includes(language))) ? 'on' : ''} onClick={() => setLanguage(k)}>{l}</button>
          ))}
        </div>
      </div>
      <label className="field"><span>Coletânea</span>
        <select value={col} onChange={(e) => setCol(e.target.value)}>
          <option value="">— Solto na estante —</option>
          {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="sheet-actions">
        {confirm
          ? <button className="xbtn danger" onClick={() => { onDelete(book); onClose(); }}>Confirmar exclusão</button>
          : <button className="xbtn ghost" onClick={() => setConfirm(true)}><Icon name="trash" size={18} />Remover</button>}
        <button className="xbtn primary" onClick={save}>Salvar</button>
      </div>
    </Sheet>
  );
}

export function CollectionSheet({ collection, books, onSave, onDelete, onClose }) {
  const isNew = !collection;
  const [name, setName] = useState(collection?.name || '');
  const [color, setColor] = useState(collection?.color || COLORS[6]);
  const [picked, setPicked] = useState(() => new Set(books.filter((b) => collection && b.collectionId === collection.id).map((b) => b.id)));
  const [q, setQ] = useState('');
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const list = books.filter((b) => !q || (b.title + ' ' + b.author).toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet title={isNew ? 'Nova coletânea' : 'Editar coletânea'} onClose={onClose} wide>
      <label className="field"><span>Nome</span><input value={name} placeholder="Ex.: Machado de Assis, Saga Duna…" onChange={(e) => setName(e.target.value)} autoFocus={isNew} /></label>
      <div className="field"><span>Cor do box</span>
        <div className="swatches">
          {COLORS.map((c) => <button key={c} className={'swatch' + (c === color ? ' on' : '')} style={{ '--c': c }} onClick={() => setColor(c)} aria-label={c} />)}
        </div>
      </div>
      <div className="field"><span>Livros ({picked.size})</span>
        <input className="mini-search" placeholder="Filtrar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="pick-grid">
          {list.map((b) => (
            <button key={b.id} className={'pick' + (picked.has(b.id) ? ' on' : '')} onClick={() => toggle(b.id)}>
              <Cover book={b} />
              <span>{b.title}</span>
            </button>
          ))}
          {!books.length && <p className="muted">Importe livros primeiro.</p>}
        </div>
      </div>
      <div className="sheet-actions">
        {!isNew && <button className="xbtn ghost" onClick={() => { onDelete(collection); onClose(); }}><Icon name="trash" size={18} />Desfazer coletânea</button>}
        <button className="xbtn primary" disabled={!name.trim()} onClick={() => { onSave({ collection, name: name.trim(), color, bookIds: [...picked] }); onClose(); }}>Salvar</button>
      </div>
    </Sheet>
  );
}
