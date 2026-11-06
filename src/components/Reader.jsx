import { useCallback, useEffect, useRef, useState } from 'react';
import { createEpubEngine, createPdfEngine, createComicEngine } from '../lib/engines.js';
import { isComic } from '../lib/library.js';
import { flipPage, isFlipping } from '../lib/flip.js';
import { getFile } from '../lib/library.js';
import { loadPref, savePref } from '../lib/db.js';
import { openExternal } from '../lib/net.js';
import { Icon } from './Icons.jsx';

export const THEMES = {
  claro: { label: 'Claro', bg: '#fbfaf6', fg: '#1f1d1a', link: '#2f62d6', ui: 'light' },
  sepia: { label: 'Sépia', bg: '#f3e9d2', fg: '#3d3022', link: '#8a4b12', ui: 'light' },
  escuro: { label: 'Escuro', bg: '#202125', fg: '#dcd9d2', link: '#8fb4ff', ui: 'dark' },
  preto: { label: 'Preto', bg: '#000000', fg: '#b9b6ae', link: '#8fb4ff', ui: 'dark' },
};
const DEFAULT_PREFS = { theme: 'claro', fontSize: 19, font: 'original', lineHeight: 1.6, margin: 'media', justify: true, pdfZoom: 1, pdfDark: false };
const FONT_OPTS = [['original', 'Original'], ['literata', 'Literata'], ['serif', 'Georgia'], ['sans', 'Outfit'], ['dyslexic', 'Verdana']];

export default function Reader({ book, ui, onClose, onSaveBook, visible }) {
  const stageRef = useRef(null);
  const engRef = useRef(null);
  const bookRef = useRef(book);
  const [prefs, setPrefs] = useState(() => loadPref('reader', DEFAULT_PREFS));
  const [info, setInfo] = useState(null);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState('');
  const [marks, setMarks] = useState(book.bookmarks || []);
  const [sliding, setSliding] = useState(null);
  const theme = THEMES[prefs.theme] || THEMES.claro;
  const fullPrefs = { ...prefs, colors: theme };

  const persist = useCallback((extra = {}) => {
    const eng = engRef.current;
    if (!eng) return;
    const next = { ...bookRef.current, progress: eng.progress(), location: eng.location(), openedAt: Date.now(), ...extra };
    bookRef.current = next;
    onSaveBook(next);
  }, [onSaveBook]);

  const refresh = useCallback(() => { const eng = engRef.current; if (eng) setInfo(eng.info()); }, []);
  const saveTimer = useRef(0);
  const after = useCallback(() => { refresh(); clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => persist(), 400); }, [refresh, persist]);

  // abre o livro
  useEffect(() => {
    let dead = false;
    setError('');
    (async () => {
      try {
        const blob = await getFile(book.id);
        if (!blob) throw new Error('Arquivo não encontrado no aparelho.');
        const make = book.format === 'pdf' ? createPdfEngine : isComic(book.format) ? createComicEngine : createEpubEngine;
        const eng = await make({ host: stageRef.current, blob, prefs: fullPrefs, onExternal: openExternal });
        if (dead) return eng.destroy();
        engRef.current = eng;
        await eng.start(book.location);
        if (!dead) { refresh(); persist(); }
      } catch (e) { console.error(e); if (!dead) setError(e.message || String(e)); }
    })();
    return () => { dead = true; clearTimeout(saveTimer.current); engRef.current?.destroy(); engRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // preferências mudaram → repagina
  const firstPrefs = useRef(true);
  useEffect(() => {
    savePref('reader', prefs);
    if (firstPrefs.current) { firstPrefs.current = false; return; }
    const t = setTimeout(() => engRef.current?.relayout(fullPrefs).then(after).catch((e) => setError(e.message)), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);

  useEffect(() => {
    let t;
    const onResize = () => { clearTimeout(t); t = setTimeout(() => engRef.current?.relayout(fullPrefs).then(after).catch((e) => setError(e.message)), 200); };
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  });

  const turn = useCallback(async (d) => {
    const eng = engRef.current;
    if (!eng || isFlipping() || !eng.canStep(d)) return;
    if (z.current.s > 1.01) { resetZoom(); applyZoom(); }
    try { await flipPage({
      stage: stageRef.current, dir: eng.flipDir ? eng.flipDir(d) : d,
      snapCurrent: () => eng.snapshot(), apply: () => eng.step(d), snapNew: () => eng.snapshot(),
      paper: theme.bg, duration: ui.flipMs, enabled: ui.flipAnim,
    });
    after(); } catch (e) { setError(e.message); }
  }, [after, theme.bg, ui.flipMs, ui.flipAnim]);

  const jump = useCallback(async (loc) => { try { resetZoom(); await engRef.current?.goTo(loc); setPanel(null); after(); } catch (e) { setError(e.message); } }, [after]); // eslint-disable-line react-hooks/exhaustive-deps

  // ctrl + roda do mouse = zoom (desktop); precisa de listener não-passivo
  useEffect(() => {
    const el = stageRef.current;
    const h = (e) => onWheelRef.current(e);
    el?.addEventListener('wheel', h, { passive: false });
    return () => el?.removeEventListener('wheel', h);
  }, []);
  const onWheelRef = useRef(() => {});

  useEffect(() => {
    const k = (e) => {
      if (e.target.closest?.('input, select, textarea')) return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); turn(1); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); turn(-1); }
      else if (e.key === 'Escape') { panel ? setPanel(null) : close(); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  // ---------------- gestos: tocar nas laterais, deslizar, pinçar, arrastar, toque duplo
  const g = useRef(null);
  const pts = useRef(new Map());
  const z = useRef({ s: 1, x: 0, y: 0 });
  const pinch = useRef(null);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const tapTimer = useRef(0);
  const sharpTimer = useRef(0);
  const [zoomed, setZoomed] = useState(false);

  const zoomEl = () => {
    const eng = engRef.current;
    return eng?.zoomable ? eng.zoomEl() : stageRef.current?.querySelector('.epub-page:not(.snap)');
  };
  const geom = () => {
    const el = zoomEl(); const st = stageRef.current?.getBoundingClientRect();
    if (!el || !st) return null;
    const r = el.getBoundingClientRect();
    return { el, st, l: r.left - z.current.x, t: r.top - z.current.y, w: el.offsetWidth, h: el.offsetHeight };
  };
  const clampPan = (gm) => {
    const c = z.current;
    const fit = (size, stageSize, off, v) => {
      const scaled = size * c.s;
      if (scaled <= stageSize) return (stageSize - scaled) / 2 - off;
      return Math.min(-off, Math.max(stageSize - scaled - off, v));
    };
    c.x = fit(gm.w, gm.st.width, gm.l - gm.st.left, c.x);
    c.y = fit(gm.h, gm.st.height, gm.t - gm.st.top, c.y);
  };
  const applyZoom = (animate = false) => {
    const el = zoomEl();
    if (!el) return;
    const c = z.current;
    el.style.transformOrigin = '0 0';
    el.style.transition = animate ? 'transform .25s ease' : 'none';
    el.style.transform = c.s === 1 && c.x === 0 && c.y === 0 ? '' : `translate(${c.x}px, ${c.y}px) scale(${c.s})`;
    setZoomed(c.s > 1.01);
    clearTimeout(sharpTimer.current);
    if (c.s > 1.2) sharpTimer.current = setTimeout(() => engRef.current?.sharpen?.(c.s), 300);
  };
  const resetZoom = () => { z.current = { s: 1, x: 0, y: 0 }; setZoomed(false); };
  const zoomAt = (s, cx, cy, animate) => {
    const gm = geom();
    if (!gm) return;
    const c = z.current;
    const px = (cx - gm.l - c.x) / c.s, py = (cy - gm.t - c.y) / c.s;
    c.s = Math.max(1, Math.min(6, s));
    c.x = cx - gm.l - px * c.s; c.y = cy - gm.t - py * c.s;
    if (c.s === 1) { c.x = 0; c.y = 0; } else clampPan(gm);
    applyZoom(animate);
  };

  const onDown = (e) => {
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ponteiro sintético */ }
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: z.current.s, font: prefs.fontSize };
      g.current = null;
    } else if (pts.current.size === 1) {
      g.current = { x: e.clientX, y: e.clientY, t: Date.now(), zx: z.current.x, zy: z.current.y, moved: false };
    }
  };
  const onMove = (e) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const eng = engRef.current;
    if (pinch.current && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.current.d);
      if (eng?.zoomable) zoomAt(pinch.current.s * ratio, (a.x + b.x) / 2, (a.y + b.y) / 2);
      else {
        const el = zoomEl();
        if (el) { el.style.transformOrigin = '50% 50%'; el.style.transition = 'none'; el.style.transform = `scale(${Math.max(0.6, Math.min(1.8, ratio))})`; }
        pinch.current.ratio = ratio;
      }
      return;
    }
    const s = g.current;
    if (!s) return;
    if (Math.abs(e.clientX - s.x) > 8 || Math.abs(e.clientY - s.y) > 8) s.moved = true;
    if (z.current.s > 1.01 && s.moved) {
      const gm = geom();
      if (!gm) return;
      z.current.x = s.zx + (e.clientX - s.x); z.current.y = s.zy + (e.clientY - s.y);
      clampPan(gm); applyZoom();
    }
  };
  const onUp = (e) => {
    pts.current.delete(e.pointerId);
    if (pinch.current) {
      if (pts.current.size === 0) {
        const p = pinch.current; pinch.current = null;
        if (!engRef.current?.zoomable && p.ratio) {
          const el = zoomEl(); if (el) el.style.transform = '';
          const size = Math.max(12, Math.min(34, Math.round(p.font * p.ratio)));
          if (size !== p.font) setP('fontSize', size);
        } else if (z.current.s < 1.05) { resetZoom(); applyZoom(true); }
      }
      return;
    }
    const s = g.current; g.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    const eng = engRef.current;
    if (z.current.s > 1.01) {
      if (!s.moved) {
        const now = Date.now();
        if (now - lastTap.current.t < 300) { clearTimeout(tapTimer.current); lastTap.current.t = 0; resetZoom(); applyZoom(true); return; }
        lastTap.current = { t: now, x: e.clientX, y: e.clientY };
        tapTimer.current = setTimeout(() => setChrome((c) => !c), 300);
      }
      return;
    }
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { turn(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) return;
    const link = eng?.handleClick(e.nativeEvent);
    if (link) { if (typeof link === 'object') jump(link); return; }
    const r = stageRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const act = () => { if (x < 0.3) turn(-1); else if (x > 0.7) turn(1); else setChrome((c) => !c); };
    if (!eng?.zoomable) return act();
    // em HQ/PDF espera um possível toque duplo (zoom 2.5x no ponto tocado)
    const now = Date.now();
    if (now - lastTap.current.t < 300 && Math.hypot(e.clientX - lastTap.current.x, e.clientY - lastTap.current.y) < 40) {
      clearTimeout(tapTimer.current); lastTap.current.t = 0;
      zoomAt(2.5, e.clientX, e.clientY, true);
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(act, 260);
  };
  const onCancel = (e) => { pts.current.delete(e.pointerId); if (!pts.current.size) { pinch.current = null; g.current = null; } };
  onWheelRef.current = (e) => {
    if (!e.ctrlKey || !engRef.current?.zoomable) return;
    e.preventDefault();
    zoomAt(z.current.s * Math.exp(-e.deltaY / 300), e.clientX, e.clientY);
  };

  const close = () => { persist(); onClose(); };
  const bookmarkHere = marks.find((m) => engRef.current?.sameSpot(m.loc));
  const toggleMark = () => {
    const eng = engRef.current;
    if (!eng) return;
    let next;
    if (bookmarkHere) next = marks.filter((m) => m !== bookmarkHere);
    else next = [...marks, { loc: eng.location(), label: info?.label || '', progress: eng.progress(), at: Date.now() }].sort((a, b) => a.progress - b.progress);
    setMarks(next);
    persist({ bookmarks: next });
  };

  const setP = (k, v) => setPrefs((p) => ({ ...p, [k]: v }));
  const pctNow = Math.round((sliding ?? info?.progress ?? 0) * 100);

  return (
    <div className={`reader ui-${theme.ui}` + (visible ? ' visible' : '') + (prefs.pdfDark && book.format === 'pdf' ? ' pdf-dark' : '')} style={{ '--paper': theme.bg, '--ink': theme.fg }}>
      <div className={'reader-stage' + (zoomed ? ' is-zoomed' : '')} ref={stageRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} />
      {!info && !error && <div className="reader-loading"><div className="loader"><span /><span /><span /></div><p>Abrindo “{book.title}”…</p></div>}
      {error && <div className="reader-loading"><p className="error-box">Não foi possível abrir: {error}</p><button className="xbtn" onClick={onClose}>Voltar à estante</button></div>}

      {info && <div className={'page-foot' + (chrome ? ' hide' : '')}>{info.pdf ? `${info.page} / ${info.pages}` : `${pctNow}% · ${info.left > 0 ? `${info.left} pág. restantes no capítulo` : 'fim do capítulo'}`}</div>}

      <header className={'r-top' + (chrome ? '' : ' hide')}>
        <button className="icon-btn" onClick={close} aria-label="Voltar à estante"><Icon name="back" /></button>
        <div className="r-title"><strong>{book.title}</strong><small>{info?.label}</small></div>
        <button className="icon-btn" onClick={() => setPanel('search')} aria-label="Buscar no livro"><Icon name="search" /></button>
        <button className={'icon-btn' + (bookmarkHere ? ' on' : '')} onClick={toggleMark} aria-label="Marcador"><svg width="22" height="22" viewBox="0 0 24 24" fill={bookmarkHere ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M6 3h12v18l-6-4-6 4z" /></svg></button>
        <button className="icon-btn" onClick={() => setPanel('toc')} aria-label="Sumário e marcadores"><Icon name="toc" /></button>
        <button className="icon-btn" onClick={() => setPanel('type')} aria-label="Aparência"><span className="aa">Aa</span></button>
      </header>

      <footer className={'r-bottom' + (chrome ? '' : ' hide')}>
        <button className="icon-btn" onClick={() => turn(-1)} aria-label="Página anterior"><Icon name="chevL" /></button>
        <div className="r-slider">
          <input type="range" min="0" max="1000" value={Math.round((sliding ?? info?.progress ?? 0) * 1000)}
            onChange={(e) => setSliding(+e.target.value / 1000)}
            onPointerUp={async () => { if (sliding != null) { await engRef.current?.goToPercent(sliding); setSliding(null); after(); } }}
            onKeyUp={async () => { if (sliding != null) { await engRef.current?.goToPercent(sliding); setSliding(null); after(); } }}
            aria-label="Posição no livro" />
          <span>{info?.pdf ? `Página ${sliding != null ? Math.round(1 + sliding * (info.pages - 1)) : info.page} de ${info.pages}` : `${pctNow}% lido`}</span>
        </div>
        <button className="icon-btn" onClick={() => turn(1)} aria-label="Próxima página"><Icon name="chevR" /></button>
      </footer>

      {panel && (
        <div className="r-panel-layer" onClick={(e) => e.target === e.currentTarget && setPanel(null)}>
          <div className="r-panel">
            <header><h3>{panel === 'toc' ? 'Sumário' : panel === 'search' ? 'Buscar no livro' : 'Aparência'}</h3>
              <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Fechar"><Icon name="close" /></button></header>
            {panel === 'toc' && <TocPanel eng={engRef.current} marks={marks} onJump={jump} />}
            {panel === 'search' && <SearchPanel eng={engRef.current} onJump={jump} />}
            {panel === 'type' && (
              <div className="type-panel">
                <div className="theme-row">
                  {Object.entries(THEMES).map(([k, t]) => (
                    <button key={k} className={'theme-dot' + (prefs.theme === k ? ' on' : '')} style={{ background: t.bg, color: t.fg }} onClick={() => setP('theme', k)}>Aa<small>{t.label}</small></button>
                  ))}
                </div>
                {book.format === 'epub' ? (
                  <>
                    <div className="size-row">
                      <button className="xbtn sm" onClick={() => setP('fontSize', Math.max(12, prefs.fontSize - 1))}>A−</button>
                      <span>{prefs.fontSize}px</span>
                      <button className="xbtn sm" onClick={() => setP('fontSize', Math.min(34, prefs.fontSize + 1))}>A+</button>
                    </div>
                    <div className="seg small">{FONT_OPTS.map(([k, l]) => <button key={k} className={prefs.font === k ? 'on' : ''} onClick={() => setP('font', k)}>{l}</button>)}</div>
                    <label className="range"><span>Entrelinha</span><input type="range" min="1.2" max="2.2" step="0.1" value={prefs.lineHeight} onChange={(e) => setP('lineHeight', +e.target.value)} /><b>{prefs.lineHeight.toFixed(1)}</b></label>
                    <div className="seg small">{['estreita', 'media', 'larga'].map((m) => <button key={m} className={prefs.margin === m ? 'on' : ''} onClick={() => setP('margin', m)}>Margem {m === 'media' ? 'média' : m}</button>)}</div>
                    <label className="toggle"><input type="checkbox" checked={prefs.justify} onChange={(e) => setP('justify', e.target.checked)} /><span>Texto justificado</span></label>
                  </>
                ) : (
                  <>
                    <p className="muted small">Pince com dois dedos para dar zoom, arraste para mover e toque duas vezes para aproximar ou voltar.</p>
                    {book.format === 'pdf'
                      ? <label className="toggle"><input type="checkbox" checked={prefs.pdfDark} onChange={(e) => setP('pdfDark', e.target.checked)} /><span>Inverter cores do PDF (modo noturno)</span></label>
                      : <label className="toggle"><input type="checkbox" checked={!!prefs.comicRtl} onChange={(e) => setP('comicRtl', e.target.checked)} /><span>Leitura de mangá (direita → esquerda)</span></label>}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TocPanel({ eng, marks, onJump }) {
  const [tab, setTab] = useState('toc');
  if (!eng) return null;
  return (
    <>
      <div className="tabs small">
        <button className={tab === 'toc' ? 'on' : ''} onClick={() => setTab('toc')}>Sumário</button>
        <button className={tab === 'marks' ? 'on' : ''} onClick={() => setTab('marks')}>Marcadores ({marks.length})</button>
      </div>
      {tab === 'toc' ? (
        <ol className="toc-list">
          {eng.toc.map((t, k) => (
            <li key={k}><button className={eng.tocActive(t) ? 'on' : ''} style={{ paddingLeft: 14 + t.depth * 16 }}
              onClick={() => onJump(eng.kind === 'pdf' ? { page: t.page } : { i: t.spineIndex, frag: t.fragment })}>{t.label}{t.page ? <small>{t.page}</small> : null}</button></li>
          ))}
          {!eng.toc.length && <p className="muted pad">Este arquivo não tem sumário.</p>}
        </ol>
      ) : (
        <ol className="toc-list">
          {marks.map((m, k) => (
            <li key={k}><button onClick={() => onJump(m.loc)}>{m.label || eng.labelFor(m.loc)}<small>{Math.round(m.progress * 100)}%</small></button></li>
          ))}
          {!marks.length && <p className="muted pad">Toque no ícone de marcador no topo para guardar a página atual.</p>}
        </ol>
      )}
    </>
  );
}

function SearchPanel({ eng, onJump }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [prog, setProg] = useState(0);
  const ctl = useRef(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const run = async (e) => {
    e.preventDefault();
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    setRes([]); setProg(0);
    const out = await eng.search(q, (p, partial) => { if (!c.signal.aborted) { setProg(p); setRes(partial); } }, c.signal);
    if (!c.signal.aborted) { setRes(out); setProg(1); }
  };
  return (
    <div className="search-panel">
      <form className="cat-search" onSubmit={run}>
        <Icon name="search" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Palavra ou frase" />
        <button className="xbtn primary sm">Buscar</button>
      </form>
      {res && prog < 1 && <div className="hi-progress"><div style={{ width: prog * 100 + '%' }} /></div>}
      {res && <p className="muted">{res.length}{res.length >= 300 ? '+' : ''} resultado(s)</p>}
      <ol className="hits">
        {res?.map((r, k) => (
          <li key={k}><button onClick={() => onJump(r.loc)}>
            <small>{r.label}</small>
            <span>…{r.snippet.slice(0, r.at)}<mark>{r.snippet.slice(r.at, r.at + r.len)}</mark>{r.snippet.slice(r.at + r.len)}…</span>
          </button></li>
        ))}
      </ol>
    </div>
  );
}
