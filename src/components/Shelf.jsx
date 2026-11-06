import { useEffect, useRef } from 'react';
import Cover from './Cover.jsx';
import { Icon } from './Icons.jsx';
import { langShort } from '../lib/lang.js';

const hashN = (s, mod) => { let h = 7; for (const c of s) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h % mod; };
const pct = (p) => Math.round((p || 0) * 100);
const isComicFmt = (f) => f === 'cbz' || f === 'cbr' || f === 'cb7';

function Book3D({ item, active }) {
  if (item.type === 'col') {
    const covers = item.books.slice(0, 3);
    return (
      <div className={'boxset3d' + (active ? ' active' : '')}>
        {covers.length === 0 && <div className="book3d"><div className="face front cover-gen" style={{ '--c': item.col.color }}><span className="cg-title">{item.col.name}</span></div></div>}
        {covers.map((b, i) => (
          <div key={b.id} className="book3d stacked" style={{ '--i': covers.length - 1 - i }}>
            <div className="face front"><Cover book={b} /></div>
            <div className="face spine3d" style={{ '--c': b.color }} />
            <div className="face pages3d" />
          </div>
        ))}
        <div className="boxset-label" style={{ '--c': item.col.color }}>{item.col.name}</div>
      </div>
    );
  }
  return (
    <div className={'book3d' + (active ? ' active' : '')}>
      <div className="face front"><Cover book={item.book} loading="eager" /></div>
      <div className="face spine3d" style={{ '--c': item.book.color }} />
      <div className="face pages3d" />
    </div>
  );
}

export default function Shelf({ items, selected, setSelected, onRead, onDetails, onToggleFav, shelfStyle }) {
  const flowRef = useRef(null);
  const trackRef = useRef(null);
  const shelfRef = useRef(null);
  const drag = useRef(null);
  const item = items[selected];

  useEffect(() => {
    const el = shelfRef.current?.querySelector(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selected, items.length]);

  const clampIdx = (i) => Math.max(0, Math.min(items.length - 1, i));
  const releaseTrack = () => {
    const t = trackRef.current;
    if (t) { t.classList.remove('dragging'); t.style.transform = ''; }
  };
  const onDown = (e) => {
    if (e.button > 0) return;
    drag.current = { x: e.clientX, t: Date.now(), moved: false };
  };
  // O livro acompanha o dedo (com resistência), sem re-renderizar o React.
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 8) { d.moved = true; trackRef.current?.classList.add('dragging'); }
    if (!d.moved || !trackRef.current) return;
    const lim = (flowRef.current?.clientWidth || 360) * 0.22;
    const edge = (dx > 0 && selected === 0) || (dx < 0 && selected === items.length - 1);
    const r = Math.sign(dx) * lim * (1 - Math.exp(-Math.abs(dx) / lim)) * (edge ? 0.35 : 1);
    trackRef.current.style.transform = `translate3d(${r}px,0,0)`;
  };
  // Cada arrasto passa no máximo UM livro, não importa a força do gesto.
  const onUp = (e) => {
    const d = drag.current; drag.current = null; drag.lastMoved = !!d?.moved;
    releaseTrack();
    if (!d?.moved) return;
    const dx = e.clientX - d.x;
    const v = Math.abs(dx) / Math.max(1, Date.now() - d.t);
    if (Math.abs(dx) > 40 || v > 0.45) setSelected(clampIdx(selected + (dx < 0 ? 1 : -1)));
  };
  const onCancel = () => { drag.current = null; releaseTrack(); };
  const onWheel = (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 20 || drag.wheelLock) return;
    drag.wheelLock = true; setTimeout(() => (drag.wheelLock = false), 380);
    setSelected(Math.max(0, Math.min(items.length - 1, selected + (d > 0 ? 1 : -1))));
  };

  const read = (e) => {
    const rect = flowRef.current?.querySelector('.flow-item.center .face.front, .flow-item.center .book3d')?.getBoundingClientRect();
    onRead(item, rect);
  };

  const color = item?.type === 'book' ? item.book.color : item?.col?.color;

  return (
    <div className="shelf-screen">
      <section className="hero" style={{ '--c': color || '#3b2d6b' }}>
        <div className="hero-bg" />
        <div className="flow" ref={flowRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onPointerLeave={(e) => drag.current && onUp(e)} onWheel={onWheel}>
          <div className="flow-track" ref={trackRef}>
          {items.map((it, idx) => {
            const off = idx - selected;
            const a = Math.abs(off);
            if (a > 3) return null;
            const side = Math.sign(off);
            const style = {
              transform: `translateX(calc(${off} * var(--step) + ${side} * var(--gap0))) translateZ(${-a * 140}px) rotateY(${-side * 52}deg) scale(${a ? 0.82 : 1})`,
              zIndex: 10 - a,
              opacity: a > 2 ? 0.35 : 1,
            };
            return (
              <div key={it.key} className={'flow-item' + (off === 0 ? ' center' : '')} style={style}
                onClick={() => { if (drag.lastMoved) { drag.lastMoved = false; return; } off === 0 ? read() : setSelected(idx); }}>
                <Book3D item={it} active={off === 0} />
                {off === 0 && <div className="reflection" />}
              </div>
            );
          })}
          </div>
          {items.length > 1 && (
            <div className="flow-count" aria-hidden="true">
              <span style={{ '--p': items.length > 1 ? selected / (items.length - 1) : 0 }} />
              <b>{selected + 1}</b> / {items.length}
            </div>
          )}
        </div>

        {item && (
          <div className="hero-info" key={item.key}>
            {item.type === 'book' ? (
              <>
                <h2 className="hi-title">{item.book.title}</h2>
                <p className="hi-author">
                  <span className="hi-name">{item.book.author || 'Autor desconhecido'}</span>
                  <span className="hi-dot" />{isComicFmt(item.book.format) ? 'HQ' : item.book.format.toUpperCase()}
                  {item.book.language ? <><span className="hi-dot" />{langShort(item.book.language)}</> : null}
                </p>
                <div className="hi-actions">
                  <button className="xbtn primary hi-read" onClick={read}>
                    <Icon name="open" size={19} />
                    {item.book.progress > 0 ? 'Continuar' : 'Começar'}
                    {item.book.progress > 0 && (
                      <span className="hi-ring" style={{ '--p': pct(item.book.progress) }}>{pct(item.book.progress)}%</span>
                    )}
                  </button>
                  <button className="xbtn icon" aria-label="Detalhes" onClick={() => onDetails(item)}><Icon name="info" /></button>
                  <button className={'xbtn icon' + (item.book.favorite ? ' on' : '')} aria-label="Favoritar" onClick={() => onToggleFav(item.book)}><Icon name={item.book.favorite ? 'starFill' : 'star'} /></button>
                </div>
              </>
            ) : (
              <>
                <h2 className="hi-title">{item.col.name}</h2>
                <p className="hi-author">Coletânea<span className="hi-dot" />{item.books.length} {item.books.length === 1 ? 'volume' : 'volumes'}</p>
                <div className="hi-actions">
                  <button className="xbtn primary hi-read" onClick={read}><Icon name="layers" size={19} />Abrir coletânea</button>
                  <button className="xbtn icon" aria-label="Editar coletânea" onClick={() => onDetails(item)}><Icon name="edit" /></button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className={'shelf-wrap shelf-' + shelfStyle}>
        <div className="shelf-back" />
        <div className="shelf" ref={shelfRef}>
          {items.map((it, idx) => {
            const sel = idx === selected;
            if (it.type === 'col') {
              return (
                <button key={it.key} data-idx={idx} className={'boxset' + (sel ? ' out' : '')} style={{ '--c': it.col.color }} onClick={() => setSelected(idx)} aria-label={it.col.name}>
                  {(it.books.length ? it.books.slice(0, 7) : [{ id: 'x', title: '', color: it.col.color }]).map((b) => (
                    <span key={b.id} className="mini-spine" style={{ '--c': b.color, height: 84 + hashN(b.id, 3) * 6 + '%' }} />
                  ))}
                  <span className="boxset-band">{it.col.name}</span>
                </button>
              );
            }
            const b = it.book;
            const w = 26 + Math.min(18, Math.round(Math.log2(1 + (b.size || 1) / 60000) * 3));
            const h = 78 + hashN(b.id, 5) * 4;
            const look = hashN(b.id + 'v', 3); // 3 acabamentos de lombada, fixos por livro
            return (
              <button key={it.key} data-idx={idx} className={`spine look-${look}` + (sel ? ' out' : '')} onClick={() => setSelected(idx)}
                style={{ '--c': b.color, width: w + 'px', height: h + '%' }} aria-label={b.title}>
                <span className="spine-cap" />
                <span className="spine-title">{b.title}</span>
                <span className="spine-band top" />
                <span className="spine-band" />
              </button>
            );
          })}
        </div>
        <div className="plank" />
      </section>

      <div className="guide-hints" aria-hidden="true">
        <span><kbd>◀</kbd><kbd>▶</kbd> navegar</span>
        <span><kbd>Enter</kbd> ler</span>
        <span><kbd>D</kbd> detalhes</span>
        <span><kbd>/</kbd> buscar</span>
      </div>
    </div>
  );
}
