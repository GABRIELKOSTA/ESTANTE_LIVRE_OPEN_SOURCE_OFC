import { Icon } from './Icons.jsx';

export default function Sidebar({ open, onClose, filter, setFilter, collections, counts, onNav, onImport, onNewCollection }) {
  const Item = ({ icon, label, count, active, onClick, color }) => (
    <button className={'side-item' + (active ? ' active' : '')} onClick={() => { onClick(); onClose(); }}>
      {color ? <span className="dot" style={{ '--c': color }} /> : <Icon name={icon} />}
      <span className="si-label">{label}</span>
      {count != null && <span className="si-count">{count}</span>}
    </button>
  );
  const is = (k, id) => filter.kind === k && (id == null || filter.id === id);
  return (
    <>
      <div className={'scrim' + (open ? ' show' : '')} onClick={onClose} />
      <aside className={'sidebar' + (open ? ' open' : '')} aria-hidden={!open}>
        <div className="side-brand">
          <span className="brand-mark" />
          <div><strong>Estante Livre</strong><small>sua biblioteca, offline</small></div>
        </div>
        <button className="side-cta" onClick={() => { onImport(); onClose(); }}><Icon name="upload" /> Importar livro ou HQ</button>

        <nav>
          <p className="side-head">Biblioteca</p>
          <Item icon="books" label="Estante completa" count={counts.all} active={is('all')} onClick={() => setFilter({ kind: 'all' })} />
          <Item icon="file" label="Livros" count={counts.livros} active={is('livros')} onClick={() => setFilter({ kind: 'livros' })} />
          <Item icon="layers" label="HQs" count={counts.hqs} active={is('hqs')} onClick={() => setFilter({ kind: 'hqs' })} />
          <Item icon="clock" label="Continuar lendo" count={counts.recent} active={is('recent')} onClick={() => setFilter({ kind: 'recent' })} />
          <Item icon="star" label="Favoritos" count={counts.fav} active={is('fav')} onClick={() => setFilter({ kind: 'fav' })} />
          <Item icon="file" label="EPUB" count={counts.epub} active={is('epub')} onClick={() => setFilter({ kind: 'epub' })} />
          <Item icon="file" label="PDF" count={counts.pdf} active={is('pdf')} onClick={() => setFilter({ kind: 'pdf' })} />

          <p className="side-head">Coletâneas <button className="mini" onClick={() => { onNewCollection(); onClose(); }} aria-label="Nova coletânea"><Icon name="plus" size={16} /></button></p>
          {collections.length === 0 && <p className="side-empty">Agrupe livros em coletâneas para montar box sets na estante.</p>}
          {collections.map((c) => (
            <Item key={c.id} color={c.color} label={c.name} count={counts.col[c.id] || 0} active={is('collection', c.id)} onClick={() => setFilter({ kind: 'collection', id: c.id })} />
          ))}

          <p className="side-head">Mais</p>
          <Item icon="compass" label="Descobrir livros" onClick={() => onNav('discover')} />
          <Item icon="sort" label="Organizar estante" onClick={() => onNav('organize')} />
          <Item icon="palette" label="Personalizar" onClick={() => onNav('settings')} />
        </nav>
        <p className="side-foot">Open source · MIT</p>
      </aside>
    </>
  );
}
