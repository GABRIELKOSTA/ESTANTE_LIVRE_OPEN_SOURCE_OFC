export function withDeadline(promise, timeout = 45000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('A fonte demorou para responder. Tente novamente.')), timeout); })]).finally(() => clearTimeout(timer));
}

export async function searchSources(sources, query, page, lang, onResult, { current = () => true, timeout = 45000, concurrency = 3, onStart = () => {} } = {}) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, async () => {
    while (current() && index < sources.length) {
      const source = sources[index++];
      try {
        onStart(source);
        const result = await withDeadline(source.search(query, page, lang), timeout);
        if (!Array.isArray(result?.items)) throw new Error('A fonte retornou um catálogo inválido.');
        if (current()) onResult(source, { result });
      } catch (error) { if (current()) onResult(source, { error }); }
    }
  }));
}
