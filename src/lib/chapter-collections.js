const comic = (b) => ['cbr', 'cbz', 'cb7', 'pdf'].includes(b.format);

export function downloadChapterGroup(file, item, source) {
  if (file.chapterGroup) return file.chapterGroup;
  if (source.kind !== 'hq') return undefined;
  const title = file.title || item.title || '';
  const match = title.match(/^(.*?)\s*(?:#|\bcap[íi]tulo\s+|\bedi[cç][aã]o\s+)(\d+(?:[.,]\d+)?)(.*)$/i);
  if (!match || !match[1].trim()) return undefined;
  const year = match[3].match(/\b((?:19|20)\d{2})\b/)?.[1];
  const name = match[1].trim() + (year ? ` (${year})` : '');
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
  return { key: source.id + ':series:' + normalized, name, chapterId: match[2].replace(',', '.'), number: match[2] };
}

export function chapterGroupOf(book) {
  const group = book.chapterGroup;
  if (group?.key && group?.chapterId && group?.name) return group;
  // Chapters downloaded by earlier app versions already retain their reader URL.
  try {
    const url = new URL(book.source);
    if (!/(^|\.)hq-now\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/hq-reader\/(\d+)\/([^/]+)\/chapter\/(\d+)(?:\/|$)/);
    if (!match) return null;
    return { key: 'hqnow:' + match[1], name: book.title.split(/\s+#/)[0], chapterId: match[3], number: book.title.match(/#([^\s·]+)/)?.[1] || match[3] };
  } catch { return null; }
}

export function planChapterImport(incoming, books, collections, uid, now = Date.now()) {
  const order = Math.max(0, ...books.map((b) => b.order || 0), ...collections.map((c) => c.order || 0)) + 1;
  let book = { ...incoming, order };
  const group = comic(book) ? chapterGroupOf(book) : null;
  if (!group) return { book, updates: [] };
  book.chapterGroup = group;
  const members = books.filter((b) => comic(b) && chapterGroupOf(b)?.key === group.key);
  const duplicate = members.find((b) => String(chapterGroupOf(b).chapterId) === String(group.chapterId));
  if (duplicate) {
    // Replace a re-downloaded chapter without losing reading progress or placement.
    book = { ...duplicate, ...book, id: duplicate.id, addedAt: duplicate.addedAt, openedAt: duplicate.openedAt,
      progress: duplicate.progress, location: duplicate.location, bookmarks: duplicate.bookmarks, favorite: duplicate.favorite,
      collectionId: duplicate.collectionId, collOrder: duplicate.collOrder, order: duplicate.order };
  }
  const existing = collections.find((c) => c.autoGroupKey === group.key);
  const eligible = [...members.filter((b) => b.id !== book.id), book]
    .filter((b) => !b.collectionId || b.collectionId === existing?.id);
  if (!existing && new Set(eligible.map((b) => String(chapterGroupOf(b).chapterId))).size < 2) return { book, updates: [] };
  const collection = existing || { id: uid(), name: group.name, color: book.color || '#f59e0b',
    order: Math.min(...eligible.map((b) => b.order || order)), createdAt: now, autoGroupKey: group.key };
  eligible.sort((a, b) => {
    const ga = chapterGroupOf(a), gb = chapterGroupOf(b);
    return String(ga.number ?? ga.chapterId).localeCompare(String(gb.number ?? gb.chapterId), 'pt-BR', { numeric: true }) || String(ga.chapterId).localeCompare(String(gb.chapterId));
  });
  const updates = eligible.map((b, index) => ({ ...b, chapterGroup: chapterGroupOf(b), collectionId: collection.id, collOrder: index }));
  book = updates.find((b) => b.id === book.id) || book;
  return { book, updates: updates.filter((b) => b.id !== book.id), collection };
}
