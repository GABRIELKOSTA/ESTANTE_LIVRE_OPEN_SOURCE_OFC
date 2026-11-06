import { useEffect, useMemo, useRef, useState } from 'react';
import sitesData from '../data/sites.json';
import { SOURCES, sourceById, resolveItem, sourceLangs, addCustomSource, removeCustomSource } from '../lib/sources.js';
import { getText } from '../lib/net.js';
import { langShort } from '../lib/lang.js';
import { coverCache, previewCover } from '../lib/images.js';
import { searchSources, withDeadline } from '../lib/source-search.js';
import { decodeLabel, fileFormat, downloadKey } from '../lib/download-links.js';
import { hashColor } from '../lib/library.js';
import { Icon } from './Icons.jsx';
import { PageHeader } from './Pages.jsx';
import { Sheet } from './Sheets.jsx';
import { fold } from './Search.jsx';
import { DownloadStatus } from './DownloadMonitor.jsx';

const rights = (s) => (/não verificad|a verificar/i.test(s) ? 'warn' : /domínio público|acesso aberto|licenças abertas|institucional/i.test(s) ? 'open' : 'mixed');
const RIGHTS_LABEL = { open: 'Aberto / domínio público', mixed: 'Conforme a obra', warn: 'Direitos não verificados' };

function RemoteCover({ item, source }) {
  const ref = useRef(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true, objectUrl, started = false;
    setUrl('');
    const load = async () => {
      if (started) return;
      started = true;
      try {
        let blob;
        if (item.cover) blob = await coverCache.load(item.cover.replace(/^http:/, 'https:'), item.url).catch(() => null);
        if (!blob && active) {
          const cover = (await previewCover(source, item))?.cover;
          if (cover) blob = await coverCache.load(cover.replace(/^http:/, 'https:'), item.url);
        }
        if (!blob || !active) return;
        if (!active) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      } catch { /* capa gerada permanece visível */ }
    };
    let observer;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); load(); } }, { rootMargin: '100px' });
      observer.observe(ref.current);
    } else load();
    return () => { active = false; observer?.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [item.key, item.cover, source?.id]);
  return <div ref={ref} className="remote-cover">{url ? <img src={url} alt="" onError={() => setUrl('')} /> : (
    <div className="cover-gen" style={{ '--c': hashColor(item.title) }}>
      <span className="cg-title">{item.title}</span>
      <span className="cg-author">{item.author}</span>
    </div>
  )}</div>;
}

export default function Discover({ onBack, jobs, download, onOpenBook }) {
  const [tab, setTab] = useState('ext');
  const [src, setSrc] = useState('all');
  const [kind, setKind] = useState('livro');
  const [lang, setLang] = useState('all');
  const pickSrc = (id) => {
    if (id !== 'all') {
      const source = sourceById(id);
      if (!source) return;
      setKind(source.kind);
      if (lang !== 'all' && !sourceLangs(source).includes(lang)) setLang('all');
    }
    setSrc(id);
  };
  const [detail, setDetail] = useState(null);
  const [sourceRevision, setSourceRevision] = useState(0);

  return (
    <div className="page">
      <PageHeader title="Descobrir livros" onBack={onBack} />
      <div className="kind-switch">
        <button className={kind === 'livro' ? 'on' : ''} onClick={() => { setKind('livro'); setSrc('all'); }}><Icon name="books" size={18} />Livros</button>
        <button className={kind === 'hq' ? 'on' : ''} onClick={() => { setKind('hq'); setSrc('all'); }}><Icon name="layers" size={18} />HQs</button>
      </div>
      <div className="tabs">
        <button className={tab === 'ext' ? 'on' : ''} onClick={() => setTab('ext')}>Extensões ({SOURCES.filter((x) => x.kind === kind).length})</button>
        <button className={tab === 'link' ? 'on' : ''} onClick={() => setTab('link')}>Por link</button>
        <button className={tab === 'manage' ? 'on' : ''} onClick={() => setTab('manage')}>Minhas extensões</button>
      </div>
      {tab === 'ext' && <Extensions kind={kind} lang={lang} setLang={(l) => { setLang(l); if (src !== 'all' && l !== 'all' && !sourceLangs(sourceById(src)).includes(l)) setSrc('all'); }} src={src} setSrc={pickSrc} onPick={(item, source) => setDetail({ item, source })} onManage={() => setTab('manage')} />}
      {tab === 'link' && <ByLink jobs={jobs} download={download} />}
      {tab === 'manage' && <ManageSources key={sourceRevision} onChanged={() => setSourceRevision(n => n + 1)} />}
      {detail && <DetailSheet {...detail} jobs={jobs} download={download} onClose={() => setDetail(null)} onOpenBook={onOpenBook} />}
    </div>
  );
}

function ManageSources({ onChanged }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const custom = SOURCES.filter(source => source.custom);

  const add = async () => {
    setError(''); setMessage('');
    try {
      let value = text.trim();
      if (!value) throw new Error('Cole o JSON de uma extensão verificada.');
      if (/^https:\/\//i.test(value)) {
        const address = new URL(value);
        if (!/\.json(?:$|[?#])/i.test(address.pathname)) throw new Error('Use o link do arquivo JSON da extensão.');
        setBusy(true);
        value = await getText(address.href);
      }
      const definition = JSON.parse(value);
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error('O JSON precisa conter a definição de uma extensão.');
      const source = addCustomSource(definition);
      onChanged(); setText(''); setMessage(`Extensão “${source.name}” adicionada a este aparelho.`);
    } catch (cause) { setError(cause?.message || 'Não foi possível adicionar a extensão.'); }
    finally { setBusy(false); }
  };

  const remove = id => {
    try { removeCustomSource(id); onChanged(); setMessage('Extensão removida deste aparelho.'); setError(''); }
    catch (cause) { setError(cause.message); }
  };

  return <div className="custom-sources">
    <p className="muted">O app começa sem extensões ativas. Importe um JSON do catálogo para ativar uma extensão nativa verificada; a seleção fica salva só neste aparelho.</p>
    <label className="field"><span>JSON ou link de um arquivo JSON</span><textarea rows="7" value={text} onChange={e => setText(e.target.value)} placeholder={'Cole aqui o JSON copiado do catálogo de extensões.'} /></label>
    <div className="row"><button className="xbtn primary" onClick={add} disabled={busy}>{busy ? 'Lendo JSON…' : 'Adicionar extensão'}</button></div>
    {message && <p className="ok-box" role="status">{message}</p>}
    {error && <p className="error-box" role="alert">{error}</p>}
    <h3>Extensões personalizadas ({custom.length})</h3>
    {!custom.length && <p className="muted">Nenhuma adicionada ainda.</p>}
    <div className="custom-source-list">{custom.map(source => <article className="site-card" key={source.id}>
      <div><strong>{source.name}</strong><p className="muted small">{source.site} · {source.kind === 'hq' ? 'HQ' : 'Livro'} · {source.lang}</p></div>
      <button className="xbtn sm danger" onClick={() => remove(source.id)}>Remover</button>
    </article>)}</div>
  </div>;
}

// ---------------------------------------------------------------- Extensões
function Extensions({ kind, lang, setLang, src, setSrc, onPick, onManage }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState({});
  const run = useRef(0);
  const ofKind = SOURCES.filter((x) => x.kind === kind && (lang === 'all' || sourceLangs(x).includes(lang)));
  const current = src === 'all' ? null : sourceById(src);
  const list = current ? [current] : ofKind;

  const load = async (sources, text, page = 1) => {
    const id = ++run.current;
    if (page === 1) setState(Object.fromEntries(sources.map((s) => [s.id, { loading: false, waiting: true, items: [] }])));
    if (page > 1) setState((st) => ({ ...st, [sources[0].id]: { ...st[sources[0].id], loading: true, error: null } }));
    await searchSources(sources, text, page, lang, (s, { result: r, error: e }) => {
      if (r) {
        setState((st) => ({ ...st, [s.id]: { items: page === 1 ? r.items : [...(st[s.id]?.items || []), ...r.items], next: r.next, page, loading: false } }));
      } else {
        setState((st) => ({ ...st, [s.id]: { ...(st[s.id] || { items: [] }), loading: false, error: e.message } }));
      }
    }, {
      current: () => id === run.current,
      onStart: (s) => setState((st) => ({ ...st, [s.id]: { ...(st[s.id] || { items: [] }), loading: true, waiting: false } })),
    });
  };

  useEffect(() => { load(list, query); return () => { run.current++; }; }, [src, query, kind, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={'ext' + (ofKind.length ? '' : ' ext-empty')}>
      {(
        <div className="seg small lang-seg">
          {[['all', 'Todos os idiomas'], ['pt', 'PT-BR'], ['en', 'Inglês']].map(([k, l]) => <button key={k} className={lang === k ? 'on' : ''} onClick={() => setLang(k)}>{l}</button>)}
        </div>
      )}
      <form className="cat-search" onSubmit={(e) => { e.preventDefault(); if (query === q.trim()) load(list, query); else setQuery(q.trim()); }}>
        <Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={current ? `Buscar em ${current.name}` : 'Buscar em todas as extensões'} enterKeyHint="search" />
        <button className="xbtn primary sm">Buscar</button>
      </form>
      <div className="ext-pills">
        <button className={'chip' + (src === 'all' ? ' on' : '')} onClick={() => setSrc('all')}>Todas</button>
        {ofKind.map((s) => (
          <button key={s.id} className={'chip' + (src === s.id ? ' on' : '')} onClick={() => setSrc(s.id)}>
            <span className="ext-dot" style={{ '--c': s.color }} />{s.name}<small>{s.lang}</small>
          </button>
        ))}
      </div>

      {!ofKind.length ? (
        <div className="ok-box">Nenhuma extensão adicionada ainda. Importe uma fonte verificada em <button className="link-button" onClick={onManage}>Minhas extensões</button>.</div>
      ) : !current ? (
        list.map((s) => {
          // antes da primeira resposta a fonte ainda não tem lista: começa como "carregando"
          const st = { loading: true, ...state[s.id], items: state[s.id]?.items || [] };
          return (
            <section key={s.id} className="ext-row">
              <header>
                <h4><span className="ext-dot" style={{ '--c': s.color }} />{s.name}</h4>
                {st.items?.length > 0 && <button className="chip" onClick={() => setSrc(s.id)}>Ver tudo <Icon name="chevR" size={14} /></button>}
              </header>
              {st.waiting && <p className="muted small">Aguardando consulta… Selecione a fonte para pesquisar agora.</p>}
              {!st.loading && !st.waiting && !st.items?.length && !st.error && <p className="muted small">Nenhum resultado nesta fonte.</p>}
              {st.error ? <div><p className="muted small">{st.error}</p><button className="chip" onClick={() => setSrc(s.id)}>Tentar nesta fonte</button></div> : (
                <div className="ext-scroll">
                  {st.loading && !st.items.length && Array.from({ length: 4 }, (_, i) => <div key={i} className="ext-card skel" />)}
                  {st.items.slice(0, 12).map((it) => (
                    <button key={it.key} className="ext-card" onClick={() => onPick(it, s)}>
                      <div className="ext-cover"><RemoteCover item={it} source={s} />{it.lang && <span className="lang-badge">{langShort(it.lang)}</span>}</div>
                      <strong>{it.title}</strong><small>{it.author}</small>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })
      ) : (
        (() => {
          const s = list[0]; const st = state[s.id] || {};
          return (
            <>
              {st.error && <div className="error-box">{st.error} <button className="xbtn sm" onClick={() => load([s], query)}>Tentar novamente</button></div>}
              <div className="ext-grid">
                {st.items?.map((it) => (
                  <button key={it.key} className="ext-card" onClick={() => onPick(it, s)}>
                    <div className="ext-cover"><RemoteCover item={it} source={s} />{it.lang && <span className="lang-badge">{langShort(it.lang)}</span>}</div>
                    <strong>{it.title}</strong><small>{it.author}</small>
                  </button>
                ))}
              </div>
              {!st.loading && !st.items?.length && !st.error && <p className="muted pad">Nenhum resultado. Tente outro termo.</p>}
              {st.loading && <div className="loader"><span /><span /><span /></div>}
              {st.next && !st.loading && <button className="xbtn wide" onClick={() => load([s], query, st.next)}>Carregar mais</button>}
            </>
          );
        })()
      )}
    </div>
  );
}

function DetailSheet({ item, source, jobs, download, onClose, onOpenBook }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [chapterQuery, setChapterQuery] = useState('');
  const [chapterCount, setChapterCount] = useState(24);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setInfo(null); setErr('');
    setChapterQuery(''); setChapterCount(24);
    withDeadline(resolveItem(source, item)).then((r) => { if (active) setInfo({ ...item, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v)), title: r.title || item.title, author: r.author || item.author, cover: r.cover || item.cover }); })
      .catch((e) => { if (active) setErr(e.message); });
    return () => { active = false; };
  }, [item, source, attempt]);
  const it = info || item;
  const files = (info?.files || []).filter((f) => !info?.chapters || !chapterQuery || fold(f.label).includes(fold(chapterQuery)));
  const visible = info?.chapters ? files.slice(0, chapterCount) : files;
  return (
    <Sheet title={source.name} onClose={onClose}>
      <div className="bs-top">
        <div className="bs-cover"><RemoteCover item={it} source={source} /></div>
        <div className="bs-facts">
          <h3 className="dt-title">{it.title}</h3>
          {it.author && <p>{it.author}</p>}
          <p className="muted small">Fica salvo no aparelho para ler sem internet.</p>
        </div>
      </div>
      {err && <div className="error-box">{err} <button className="xbtn sm" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button></div>}
      {info?.description && <p className="muted small">{info.description}</p>}
      {!info && !err && <div className="loader"><span /><span /><span /></div>}
      {info && (
        <div className="dl-list">
          {info.chapters && <div className="chapter-tools">
            <p>{info.files.length} capítulos · escolha uma edição para baixar e ler offline.</p>
            <input aria-label="Buscar capítulo" placeholder="Buscar capítulo por número ou nome…" value={chapterQuery} onChange={(e) => { setChapterQuery(e.target.value); setChapterCount(24); }} />
          </div>}
          {visible.length ? visible.map((f) => {
            const key = downloadKey(f, item, source);
            const j = jobs[key];
            const busy = j && !j.done && !j.error;
            return (
              <div key={key} className="download-option"><div className="dl-row">
                <span className="tag">{f.format === 'bin' ? 'ARQUIVO' : f.format.toUpperCase()}</span>
                <span className="dl-name">{f.label}</span>
                {j?.done
                  ? <button className="xbtn sm done" onClick={() => onOpenBook(j.bookId)}>Ler agora</button>
                  : <button className="xbtn sm primary" disabled={busy} onClick={() => download(f, it, source)}>
                      {busy ? (j.p > 0 ? Math.round(j.p * 100) + '%' : 'Baixando…') : <><Icon name="download" size={16} />{j?.error ? 'Tentar de novo' : 'Baixar'}</>}
                    </button>}
              </div>{busy && <p className="muted small download-status"><DownloadStatus job={j} /></p>}{j?.error && <p className="error-box small" role="alert">{j.error}</p>}</div>
            );
          }) : <p className="muted">{info.chapters ? (info.files.length ? 'Nenhum capítulo corresponde à busca.' : 'Esta HQ ainda não tem capítulos disponíveis para baixar.') : 'A fonte não disponibilizou um arquivo para baixar dentro do app neste item.'}</p>}
          {info.chapters && files.length > visible.length && <button className="xbtn wide" onClick={() => setChapterCount((n) => n + 24)}>Mostrar mais capítulos ({visible.length} de {files.length})</button>}
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Sites
function Sites({ kind, onUseExt }) {
  const ofKind = sitesData.sites.filter((s) => s.tipo === kind);
  const cats = useMemo(() => [...new Set(ofKind.map((s) => s.categoria))], [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [fmt, setFmt] = useState('');
  const [onlyExt, setOnlyExt] = useState(true);
  const list = ofKind.filter((s) =>
    (!cat || s.categoria === cat) && (!fmt || s.formatos.toUpperCase().includes(fmt)) && (!onlyExt || s.extensao) &&
    (!q || fold(`${s.nome} ${s.categoria} ${s.formatos}`).includes(fold(q))));
  return (
    <div className="sites">
      <p className="muted small">Escolha uma fonte para pesquisar e baixar dentro do app. A disponibilidade depende do arquivo e da resposta do servidor.</p>
      <div className="site-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar site…" />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Todas as categorias</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <div className="seg small">
          {(kind === 'hq' ? ['', 'CBR', 'CBZ', 'PDF'] : ['', 'EPUB', 'PDF']).map((f) => <button key={f} className={fmt === f ? 'on' : ''} onClick={() => setFmt(f)}>{f || 'Todos'}</button>)}
        </div>
        <label className="toggle"><input type="checkbox" checked={onlyExt} onChange={(e) => setOnlyExt(e.target.checked)} /><span>Só com extensão</span></label>
      </div>
      <p className="muted">{list.length} sites</p>
      <div className="site-grid">
        {list.map((s) => {
          const r = rights(s.situacao_direitos);
          return (
            <article key={s.nome + s.url} className={'site-card' + (s.extensao ? ' has-ext' : '')}>
              <header><strong>{s.nome}</strong>{s.extensao ? <span className="rights ext">Extensão</span> : <span className={'rights ' + r}>{RIGHTS_LABEL[r]}</span>}</header>
              <small className="muted">{s.categoria}</small>
              <dl>
                <div><dt>Formatos</dt><dd>{s.formatos}</dd></div>
                <div><dt>Download</dt><dd>{s.download_direto}</dd></div>
                <div><dt>Direitos</dt><dd>{s.situacao_direitos}</dd></div>
              </dl>
              <div className="site-actions">
                {s.extensao && <button className="xbtn sm primary" onClick={() => onUseExt(s.extensao)}><Icon name="search" size={16} />Buscar no app</button>}
                {!s.extensao && <span className="muted small">Sem download integrado.</span>}
              </div>
            </article>
          );
        })}
      </div>
      <p className="muted small-print">Downloads concluídos ficam na estante para leitura offline.</p>
    </div>
  );
}

function ByLink({ jobs, download }) {
  const [url, setUrl] = useState('');
  const u = url.trim();
  const j = jobs[u];
  const valid = /^https?:\/\/.+/i.test(u);
  const name = decodeLabel(u.split('/').pop().split('?')[0] || 'livro').replace(/\.(epub|pdf|cbr|cbz)$/i, '');
  return (
    <div className="bylink">
      <p>Cole o endereço direto de um arquivo <b>EPUB</b>, <b>PDF</b>, <b>CBR</b> ou <b>CBZ</b>. O app baixa e guarda na estante para ler sem internet.</p>
      <div className="row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://exemplo.org/livro.epub" inputMode="url" />
        <button className="xbtn primary sm" disabled={!valid || (j && !j.error && !j.done)}
          onClick={() => download({ url: u, format: fileFormat(u) || 'bin' }, { key: u, title: '', author: '', cover: null, name }, { id: 'link', name: 'Link' })}>
          {j && !j.error && !j.done ? (j.p > 0 ? Math.round(j.p * 100) + '%' : 'Baixando…') : <><Icon name="download" size={16} />Baixar</>}
        </button>
      </div>
      {j?.done && <p className="ok-box">Pronto! O livro está na estante.</p>}
      {j?.error && <p className="error-box">{j.error}</p>}
    </div>
  );
}
