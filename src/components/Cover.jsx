import { useEffect, useState } from 'react';

const urlCache = new WeakMap();
export function coverUrl(blob) {
  if (!blob) return null;
  if (!urlCache.has(blob)) urlCache.set(blob, URL.createObjectURL(blob));
  return urlCache.get(blob);
}

export function useCover(book) {
  const [url, setUrl] = useState(() => coverUrl(book?.cover));
  useEffect(() => { setUrl(coverUrl(book?.cover)); }, [book?.cover]);
  return url;
}

// Capa: imagem real ou capa gerada com título/autor.
export default function Cover({ book, className = '', loading = 'lazy' }) {
  const url = useCover(book);
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return <img className={'cover-img ' + className} src={url} alt={book.title} loading={loading} draggable="false" onError={() => setFailed(true)} />;
  }
  return (
    <div className={'cover-gen ' + className} style={{ '--c': book?.color || '#334' }}>
      <span className="cg-format">{book?.format?.toUpperCase()}</span>
      <span className="cg-title">{book?.title}</span>
      <span className="cg-author">{book?.author}</span>
    </div>
  );
}
