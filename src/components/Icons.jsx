const P = {
  qr: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 15h2v6h-6v-2M12 3v3M3 12h3M12 12h3M12 18v3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v6M12 7.5v.5',
  open: 'M3 5.5c3-1.2 6-1.2 9 .8 3-2 6-2 9-.8V19c-3-1.2-6-1.2-9 .8-3-2-6-2-9-.8zM12 6.3v13.5',
  caret: 'M7 10l5 5 5-5',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z',
  starFill: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z',
  books: 'M5 4h3v16H5zM10 4h3v16h-3zM15.5 5l2.9-.8 3.6 15.4-2.9.8z',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  compass: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  sort: 'M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3',
  palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-1.2-1-1.4-1-2.4 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
  toc: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  type: 'M4 7V5h16v2M9 19h6M12 5v14',
  chevL: 'M15 5l-7 7 7 7',
  chevR: 'M9 5l7 7-7 7',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  folder: 'M3 6h6l2 2h10v11H3z',
  globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
};

export function Icon({ name, size = 22, className = '' }) {
  const fill = name === 'starFill' || name === 'bookmarkFill';
  const d = P[name] || P[name?.replace('Fill', '')] || '';
  return (
    <svg className={'icon ' + className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
