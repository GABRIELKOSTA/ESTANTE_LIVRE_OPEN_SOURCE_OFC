// Idioma dos livros: normaliza códigos (pt-BR, por, eng…) e detecta pelo texto.
export const LANG_LABEL = { pt: 'PT-BR', en: 'Inglês', es: 'Espanhol', fr: 'Francês', it: 'Italiano', de: 'Alemão', '': 'Sem idioma' };
export const langLabel = (l) => LANG_LABEL[l] ?? (l ? l.toUpperCase() : 'Sem idioma');
export const langShort = (l) => ({ pt: 'PT-BR', en: 'EN', es: 'ES', fr: 'FR', it: 'IT', de: 'DE' }[l] || (l ? l.toUpperCase() : '?'));
// grupos usados na estante: PT-BR, Inglês e "Outros" (demais idiomas + sem idioma)
export const langBucket = (l) => (l === 'pt' || l === 'en' ? l : 'other');

const CODES = {
  pt: ['pt', 'por', 'portuguese', 'português', 'portugues'],
  en: ['en', 'eng', 'english', 'inglês', 'ingles'],
  es: ['es', 'spa', 'spanish', 'español', 'espanol', 'espanhol'],
  fr: ['fr', 'fre', 'fra', 'french', 'français'],
  it: ['it', 'ita', 'italian', 'italiano'],
  de: ['de', 'ger', 'deu', 'german', 'deutsch'],
};
export function normLang(code) {
  if (!code) return '';
  const c = String(code).trim().toLowerCase().split(/[-_\s,;]/)[0];
  for (const [k, list] of Object.entries(CODES)) if (list.includes(c)) return k;
  return c.length <= 3 ? c : '';
}

// palavras muito frequentes de cada idioma (com espaços em volta)
const STOP = {
  pt: ['de', 'que', 'não', 'uma', 'com', 'para', 'os', 'das', 'dos', 'em', 'ao', 'mais', 'como', 'mas', 'foi', 'ele', 'ela', 'seu', 'sua', 'você', 'também', 'então', 'são', 'está', 'isso'],
  en: ['the', 'and', 'of', 'to', 'is', 'that', 'was', 'with', 'for', 'his', 'her', 'he', 'she', 'it', 'you', 'this', 'are', 'not', 'but', 'have', 'they', 'from', 'which', 'were', 'be'],
  es: ['el', 'los', 'las', 'del', 'una', 'por', 'con', 'pero', 'muy', 'está', 'como', 'más', 'su', 'para', 'es', 'lo', 'le', 'ya', 'también', 'hay', 'fue', 'yo', 'sí', 'cuando', 'esto'],
};
const PT_ONLY = /[ãõ]|ção\b|ções\b|\bnão\b|\bvocê\b/i;

export function detectText(text = '') {
  const t = ' ' + text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ') + ' ';
  if (t.length < 40) return '';
  const score = {};
  for (const [k, words] of Object.entries(STOP)) {
    let n = 0;
    for (const w of words) { let i = t.indexOf(` ${w} `); while (i >= 0) { n++; i = t.indexOf(` ${w} `, i + w.length + 1); } }
    score[k] = n;
  }
  if (PT_ONLY.test(t)) score.pt += 5;
  const [best, second] = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (best[1] < 6 || best[1] < second[1] * 1.3) return '';
  return best[0];
}

// títulos são curtos: só pistas fortes
export function detectTitle(title = '') {
  const t = ` ${title.toLowerCase()} `;
  if (/[ãõçáéíóúâêô]/.test(t) || /\b(o|a|os|as|do|da|dos|das|de|e|em|no|na|um|uma)\b/.test(t.replace(/\(.*?\)/g, ''))) return 'pt';
  if (/\b(the|of|and|vol|volume|issue|annual|chapter)\b/.test(t)) return 'en';
  return '';
}
