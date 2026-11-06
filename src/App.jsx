import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import * as lib from './lib/library.js';
import { loadPref, savePref, persistStorage } from './lib/db.js';
import Shelf from './components/Shelf.jsx';
import Sidebar from './components/Sidebar.jsx';
import Search from './components/Search.jsx';
import Reader, { THEMES } from './components/Reader.jsx';
import OpenTransition from './components/OpenTransition.jsx';
import Discover from './components/Discover.jsx';
import { Organize, Settings } from './components/Pages.jsx';
import { BookSheet, CollectionSheet } from './components/Sheets.jsx';
import { Icon } from './components/Icons.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { langBucket } from './lib/lang.js';
import { createDownloadManager } from './lib/download-manager.js';
import DownloadMonitor from './components/DownloadMonitor.jsx';
import { createWifiReceiver } from './lib/wifi-share.js';

const DEFAULT_UI = { accentMode: 'rgb', accent: '#7a5cff', rgbSpeed: 6, glow: 60, shelf: 'madeira', showHints: true, openAnim: true, flipAnim: true, flipMs: 620 };

function buildItems(everyBook, collections, filter, lang = 'all') {
  const allBooks = lang === 'all' ? everyBook : everyBook.filter((b) => langBucket(b.language) === lang);
  const books = filter.kind === 'livros' ? allBooks.filter((b) => !lib.isComic(b.format)) : filter.kind === 'hqs' ? allBooks.filter((b) => lib.isComic(b.format)) : allBooks;
  const byKind = filter.kind === 'livros' || filter.kind === 'hqs' || lang !== 'all';
  const asBook = (b) => ({ key: 'b' + b.id, type: 'book', book: b });
  const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
  switch (filter.kind) {
    case 'collection':
      return books.filter((b) => b.collectionId === filter.id).sort((a, b) => a.collOrder - b.collOrder).map(asBook);
    case 'recent':
      return books.filter((b) => b.openedAt).sort((a, b) => b.openedAt - a.openedAt).map(asBook);
    case 'fav': return books.filter((b) => b.favorite).sort(byOrder).map(asBook);
    case 'epub': case 'pdf': return books.filter((b) => b.format === filter.kind).sort(byOrder).map(asBook);
    default: {
      const cols = collections.filter((c) => !byKind || books.some((b) => b.collectionId === c.id)).map((c) => ({
        key: 'c' + c.id, type: 'col', col: c, order: c.order,
        books: books.filter((b) => b.collectionId === c.id).sort((a, b) => a.collOrder - b.collOrder),
      }));
      const loose = books.filter((b) => !b.collectionId).map((b) => ({ ...asBook(b), order: b.order }));
      return [...cols, ...loose].sort(byOrder);
    }
  }
}

const FILTER_LABEL = { all: 'Estante', livros: 'Livros', hqs: 'HQs', recent: 'Continuar lendo', fav: 'Favoritos', epub: 'EPUB', pdf: 'PDF' };
const ROOT_KINDS = ['all', 'livros', 'hqs'];

export default function App() {
  const [data, setData] = useState({ books: [], collections: [] });
  const [loaded, setLoaded] = useState(false);
  const [ui, setUiState] = useState(() => loadPref('ui', DEFAULT_UI));
  const [filter, setFilter] = useState({ kind: 'all' });
  const [lang, setLang] = useState(() => loadPref('shelf', { lang: 'all' }).lang);
  const pickLang = (l) => { setLang(l); savePref('shelf', { lang: l }); };
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState('shelf');
  const [sidebar, setSidebar] = useState(false);
  const [search, setSearch] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [reading, setReading] = useState(null);
  const [toast, setToast] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);
  const wantKey = useRef(null);

  const setUi = (v) => { setUiState(v); savePref('ui', v); };
  const notify = useCallback((msg, kind = 'ok', duration = 3600) => {
    setToast({ msg, kind, duration, id: Date.now() });
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.duration); return () => clearTimeout(t); }, [toast]);

  const reload = useCallback(async () => { setData(await lib.loadLibrary()); setLoaded(true); }, []);
  useEffect(() => { reload(); persistStorage(); }, [reload]);

  const items = useMemo(() => buildItems(data.books, data.collections, filter, lang), [data, filter, lang]);
  useEffect(() => { setSelected(0); }, [filter, lang]);
  // livros antigos (sem idioma) são classificados em segundo plano
  const detecting = useRef(false);
  useEffect(() => {
    if (!loaded || detecting.current || !data.books.some((b) => b.language === undefined)) return;
    detecting.current = true;
    lib.detectMissingLanguages(data.books, (nb) => setData((d) => ({ ...d, books: d.books.map((x) => (x.id === nb.id ? nb : x)) })))
      .finally(() => { detecting.current = false; });
  }, [loaded, data.books]);
  useEffect(() => {
    if (wantKey.current) {
      const idx = items.findIndex((it) => it.key === wantKey.current);
      if (idx >= 0) { setSelected(idx); wantKey.current = null; }
    }
    if (selected > items.length - 1) setSelected(Math.max(0, items.length - 1));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const col = {};
    data.books.forEach((b) => { if (b.collectionId) col[b.collectionId] = (col[b.collectionId] || 0) + 1; });
    return {
      all: data.books.length, recent: data.books.filter((b) => b.openedAt).length, fav: data.books.filter((b) => b.favorite).length,
      epub: data.books.filter((b) => b.format === 'epub').length, pdf: data.books.filter((b) => b.format === 'pdf').length, col,
      lang: { pt: data.books.filter((b) => langBucket(b.language) === 'pt').length, en: data.books.filter((b) => langBucket(b.language) === 'en').length, other: data.books.filter((b) => langBucket(b.language) === 'other').length },
      hqs: data.books.filter((b) => lib.isComic(b.format)).length, livros: data.books.filter((b) => !lib.isComic(b.format)).length,
    };
  }, [data.books]);

  // ---- ações
  const saveBook = useCallback(async (b) => {
    setData((d) => ({ ...d, books: d.books.map((x) => (x.id === b.id ? b : x)) }));
    await lib.saveBook(b);
  }, []);
  const saveReading = useCallback(async (b) => {
    const saved = await lib.saveReadingProgress(b);
    if (saved) setData((d) => ({ ...d, books: d.books.map((x) => x.id === saved.id ? saved : x) }));
  }, []);

  const importFiles = async (files) => {
    const list = [...files].filter((f) => /\.(epub|pdf|cbr|cbz|cb7)$/i.test(f.name) || /pdf|epub|comicbook|rar|zip/.test(f.type));
    if (!list.length) return notify('Escolha arquivos EPUB, PDF, CBR ou CBZ', 'error');
    let last = null, ok = 0;
    for (const [k, f] of list.entries()) {
      notify(`Importando ${k + 1}/${list.length}: ${f.name}`, 'info');
      try { last = await lib.importBook(f, { name: f.name }); ok++; } catch (e) { notify(e.message, 'error'); }
    }
    if (last) {
      wantKey.current = 'b' + last.id;
      setFilter({ kind: 'all' });
      setView('shelf');
      await reload();
      notify(ok > 1 ? `${ok} livros adicionados à estante.` : `“${last.title}” está na estante.`);
    }
  };
  const importBlob = async (blob, meta) => {
    const b = await lib.importBook(blob, meta);
    wantKey.current = b.collectionId ? 'c' + b.collectionId : 'b' + b.id;
    await reload();
    return b;
  };

  const downloadCallbacks = useRef(null);
  downloadCallbacks.current = { importBlob, notify };
  const wifiReceiver = useRef(null);
  if (!wifiReceiver.current) wifiReceiver.current = createWifiReceiver({
    importBlob: (...args) => downloadCallbacks.current.importBlob(...args),
    onProgress: stage => downloadCallbacks.current.notify(stage, 'info', 6000),
  });
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const receive = async ({ url }) => {
      if (!url?.startsWith('estantelivre://receive')) return;
      try {
        const book = await wifiReceiver.current(url);
        setView('shelf'); setSheet(null); setFilter({ kind: 'all' });
        notify('“' + book.title + '” recebido por Wi-Fi e adicionado à estante.');
      } catch (error) { notify('Falha ao receber por Wi-Fi: ' + error.message, 'error', 8000); }
    };
    const listener = CapApp.addListener('appUrlOpen', receive);
    CapApp.getLaunchUrl().then(launch => launch && receive(launch)).catch(() => {});
    return () => { listener.then(l => l.remove()); };
  }, [notify]);
  const managerRef = useRef(null);
  if (!managerRef.current) managerRef.current = createDownloadManager({
    importBlob: (...args) => downloadCallbacks.current.importBlob(...args),
    notify: (...args) => downloadCallbacks.current.notify(...args),
  });
  const manager = managerRef.current;
  const [jobs, setJobs] = useState(() => manager.snapshot());
  useEffect(() => manager.subscribe(setJobs), [manager]);

  const openItem = (item, rect) => {
    if (!item) return;
    if (item.type === 'col') { setFilter({ kind: 'collection', id: item.col.id }); return; }
    setReading({ book: item.book, phase: ui.openAnim ? 'opening' : 'open', from: rect });
  };
  const showDetails = (item) => {
    if (!item) return;
    setSheet(item.type === 'col' ? { type: 'col', col: item.col } : { type: 'book', book: item.book });
  };
  const closeReader = () => {
    setReading((r) => (r ? { ...r, phase: 'closing' } : r));
    setTimeout(() => { setReading(null); reload(); }, 380);
  };

  // ---- teclado (estilo console)
  useEffect(() => {
    if (reading || view !== 'shelf' || search || sheet) return;
    const k = (e) => {
      if (e.target.closest?.('input, select, textarea')) return;
      if (e.key === 'ArrowRight') setSelected((s) => Math.min(items.length - 1, s + 1));
      else if (e.key === 'ArrowLeft') setSelected((s) => Math.max(0, s - 1));
      else if (e.key === 'Enter') {
        const rect = document.querySelector('.flow-item.center .face.front')?.getBoundingClientRect();
        openItem(items[selected], rect);
      } else if (e.key.toLowerCase() === 'd') showDetails(items[selected]);
      else if (e.key === '/') { e.preventDefault(); setSearch(true); }
      else if (e.key === 'Escape' && filter.kind !== 'all') setFilter({ kind: 'all' });
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  // ---- botão voltar do Android
  const backRef = useRef(() => false);
  backRef.current = () => {
    if (reading) { if (reading.phase === 'open') closeReader(); return true; }
    if (sheet) { setSheet(null); return true; }
    if (search) { setSearch(false); return true; }
    if (sidebar) { setSidebar(false); return true; }
    if (view !== 'shelf') { setView('shelf'); return true; }
    if (filter.kind !== 'all') { setFilter({ kind: 'all' }); return true; }
    return false;
  };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('backButton', () => { if (!backRef.current()) CapApp.exitApp(); });
    return () => { h.then((x) => x.remove()); };
  }, []);

  const currentCol = filter.kind === 'collection' ? data.collections.find((c) => c.id === filter.id) : null;
  const rootStyle = {
    '--rgb-speed': ui.rgbSpeed + 's',
    '--glow': ui.glow / 100,
    '--accent': ui.accentMode === 'single' ? ui.accent : undefined,
  };
  const readerPaper = THEMES[loadPref('reader', { theme: 'claro' }).theme]?.bg || '#fbfaf6';

  return (
    <div className={`app accent-${ui.accentMode}` + (ui.showHints ? '' : ' no-hints') + (dragOver ? ' drag-over' : '')} style={rootStyle}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); importFiles(e.dataTransfer.files); }}>
      <div className="ambient" />

      {view === 'shelf' && (
        <>
          <header className="topbar">
            {currentCol || !ROOT_KINDS.includes(filter.kind)
              ? <button className="icon-btn" onClick={() => setFilter({ kind: 'all' })} aria-label="Voltar à estante"><Icon name="back" /></button>
              : <button className="icon-btn" onClick={() => setSidebar(true)} aria-label="Menu"><Icon name="menu" /></button>}
            <div className="tb-title">
              <h1>{currentCol ? currentCol.name : FILTER_LABEL[filter.kind]}</h1>
              {currentCol && <small>Coletânea · {items.length} {items.length === 1 ? 'item' : 'itens'}</small>}
            </div>
            {(currentCol || !ROOT_KINDS.includes(filter.kind)) && <button className="icon-btn" onClick={() => setSidebar(true)} aria-label="Menu"><Icon name="menu" /></button>}
            <button className="icon-btn" onClick={() => setSearch(true)} aria-label="Buscar"><Icon name="search" /></button>
            <button className="icon-btn accent" onClick={() => fileInput.current?.click()} aria-label="Importar livro"><Icon name="plus" /></button>
          </header>

          {data.books.length > 0 && (
            <div className="filter-bar">
              {ROOT_KINDS.includes(filter.kind) ? (
                <div className="seg-pill" role="tablist">
                  {ROOT_KINDS.map((k) => (
                    <button key={k} role="tab" aria-selected={filter.kind === k} className={filter.kind === k ? 'on' : ''} onClick={() => setFilter({ kind: k })}>
                      {k === 'all' ? 'Tudo' : FILTER_LABEL[k]}<small>{k === 'all' ? counts.all : counts[k]}</small>
                    </button>
                  ))}
                </div>
              ) : <span />}
              <label className={'lang-pick' + (lang !== 'all' ? ' on' : '')}>
                <Icon name="globe" size={15} />
                <select value={lang} onChange={(e) => pickLang(e.target.value)} aria-label="Idioma">
                  {[['all', 'Idiomas'], ['pt', 'PT-BR'], ['en', 'Inglês'], ['other', 'Outros']]
                    .filter(([k]) => k === 'all' || k === lang || counts.lang[k] > 0)
                    .map(([k, l]) => <option key={k} value={k}>{l}{k !== 'all' ? ` (${counts.lang[k]})` : ''}</option>)}
                </select>
                <Icon name="caret" size={14} />
              </label>
            </div>
          )}
          {loaded && items.length === 0 ? (
            <div className="empty">
              <div className="empty-shelf"><span /><span /><span /></div>
              <h2>{filter.kind === 'all' ? 'Sua estante está esperando' : 'Nada por aqui ainda'}</h2>
              <p>Importe arquivos <b>EPUB</b> ou <b>PDF</b> do aparelho, ou encontre livros gratuitos para baixar e ler sem internet.</p>
              <div className="hi-actions">
                <button className="xbtn primary" onClick={() => fileInput.current?.click()}><Icon name="upload" size={18} />Importar arquivos</button>
                <button className="xbtn" onClick={() => setView('discover')}><Icon name="compass" size={18} />Descobrir livros</button>
              </div>
            </div>
          ) : (
            <Shelf items={items} selected={selected} setSelected={setSelected} onRead={openItem} onDetails={showDetails}
              onToggleFav={(b) => saveBook({ ...b, favorite: !b.favorite })} shelfStyle={ui.shelf} />
          )}
        </>
      )}

      {view === 'discover' && (
        <ErrorBoundary onBack={() => setView('shelf')}>
          <Discover onBack={() => setView('shelf')} jobs={jobs} download={manager.download}
            onOpenBook={async (id) => { const b = (await lib.loadLibrary()).books.find((x) => x.id === id); if (b) { setView('shelf'); setReading({ book: b, phase: ui.openAnim ? 'opening' : 'open' }); } }} />
        </ErrorBoundary>
      )}
      {view === 'organize' && (
        <Organize key={data.books.length + ':' + data.collections.length} books={data.books} collections={data.collections} onBack={() => setView('shelf')}
          onEditCollection={(c) => setSheet({ type: 'col', col: c })}
          onSave={async (b, c) => { await lib.saveOrder(b, c); await reload(); notify('Ordem da estante salva.'); }} />
      )}
      {view === 'settings' && (
        <Settings ui={ui} setUi={setUi} onBack={() => setView('shelf')}
          stats={{ count: data.books.length, bytes: data.books.reduce((a, b) => a + (b.size || 0), 0) }} />
      )}

      <Sidebar open={sidebar} onClose={() => setSidebar(false)} filter={filter}
        setFilter={(f) => { setFilter(f); setView('shelf'); }} collections={[...data.collections].sort((a, b) => a.order - b.order)} counts={counts}
        onNav={setView} onImport={() => fileInput.current?.click()} onNewCollection={() => setSheet({ type: 'col', col: null })} />

      {search && (
        <Search books={data.books} collections={data.collections} onClose={() => setSearch(false)}
          onPick={(b) => { setSearch(false); wantKey.current = 'b' + b.id; setFilter({ kind: b.collectionId ? 'collection' : 'all', id: b.collectionId || undefined }); setView('shelf'); }} />
      )}

      {sheet?.type === 'book' && (
        <BookSheet book={sheet.book} collections={data.collections} onClose={() => setSheet(null)}
          onRead={() => openItem({ type: 'book', book: sheet.book })}
          onSave={async (b) => { await lib.saveBook(b); await reload(); }}
          onDelete={async (b) => { await lib.deleteBook(b.id); await reload(); notify(`“${b.title}” removido.`); }} />
      )}
      {sheet?.type === 'col' && (
        <CollectionSheet collection={sheet.col} books={data.books} onClose={() => setSheet(null)}
          onDelete={async (c) => { await lib.deleteCollection(c.id); if (filter.id === c.id) setFilter({ kind: 'all' }); await reload(); }}
          onSave={async ({ collection, name, color, bookIds }) => {
            if (!collection) {
              const c = await lib.createCollection(name, color, bookIds);
              wantKey.current = 'c' + c.id;
            } else {
              await lib.saveCollection({ ...collection, name, color });
              const changed = data.books.filter((b) => (b.collectionId === collection.id) !== bookIds.includes(b.id))
                .map((b) => ({ ...b, collectionId: bookIds.includes(b.id) ? collection.id : null, collOrder: bookIds.indexOf(b.id) }));
              await Promise.all(changed.map(lib.saveBook));
            }
            await reload();
            notify('Coletânea salva.');
          }} />
      )}

      {reading && (
        <Reader key={reading.book.id} book={reading.book} ui={ui} onSaveBook={saveReading} onClose={closeReader}
          visible={reading.phase === 'open' || reading.phase === 'reveal'} />
      )}
      {reading?.phase === 'opening' || reading?.phase === 'reveal' ? (
        <OpenTransition book={reading.book} from={reading.from} paper={readerPaper}
          onReveal={() => setReading((r) => ({ ...r, phase: 'reveal' }))}
          onDone={() => setReading((r) => (r ? { ...r, phase: 'open' } : r))} />
      ) : null}

      <input ref={fileInput} type="file" hidden multiple accept={Capacitor.isNativePlatform() ? undefined : '.epub,.pdf,.cbr,.cbz,application/epub+zip,application/pdf,application/vnd.comicbook+zip,application/vnd.comicbook-rar'}
        onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} />

      <DownloadMonitor jobs={jobs} withToast={Boolean(toast)} />
      {toast && <div key={toast.id} className={'toast ' + toast.kind} role="status">{toast.msg}</div>}
      {dragOver && <div className="drop-hint">Solte seus EPUB / PDF aqui</div>}
    </div>
  );
}
