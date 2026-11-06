import { useEffect, useRef } from 'react';
import Cover from './Cover.jsx';

// O livro sai da estante inclinado, sobe até o centro, endireita, a capa abre
// (com luz e sombra reagindo ao giro) e a câmera mergulha na primeira página.
export default function OpenTransition({ book, from, paper, onReveal, onDone }) {
  const wrap = useRef(null);
  const cover = useRef(null);
  const scrim = useRef(null);
  const shade = useRef(null);
  const sheen = useRef(null);
  const lines = useRef(null);

  useEffect(() => {
    let dead = false;
    const anims = [];
    const run = (el, frames, opts) => { const a = el.animate(frames, { fill: 'forwards', ...opts }); anims.push(a); return a; };

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onReveal(); onDone();
      return undefined;
    }

    const vw = innerWidth, vh = innerHeight;
    const h = Math.min(vh * 0.62, (vw / 2) * 0.92 * 1.5); // aberto, as duas folhas cabem na tela
    const w = h / 1.5;
    const tx = (vw - w) / 2, ty = (vh - h) / 2;
    const src = from && from.width > 10 ? from : { left: tx + w * 0.2, top: ty + h * 0.2, width: w * 0.6, height: h * 0.6 };
    const el = wrap.current;
    Object.assign(el.style, { left: tx + 'px', top: ty + 'px', width: w + 'px', height: h + 'px' });

    const s0 = src.width / w;
    const sx = src.left + src.width / 2 - (tx + w / 2);
    const sy = src.top + src.height / 2 - (ty + h / 2);
    const T = (x, y, s, ry = 0, z = 0) => `translate3d(${x}px, ${y}px, ${z}px) scale(${s}) rotateY(${ry}deg)`;
    const fill = Math.max(vw / w, vh / h) * 1.08;

    const ease = 'cubic-bezier(.45,0,.2,1)';
    const LIFT = 520, OPEN = 760, DIVE = 560;

    (async () => {
      run(scrim.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });

      // 1) sai da estante: sobe num leve arco, cresce e endireita
      await run(el, [
        { transform: T(sx, sy, s0, -14), offset: 0 },
        { transform: T(sx * 0.35, sy * 0.35 - 18, (s0 + 1.06) / 2, -10, 40), offset: 0.55 },
        { transform: T(0, 0, 1.04, -3, 30), offset: 0.85 },
        { transform: T(0, 0, 1, 0) },
      ], { duration: LIFT, easing: 'cubic-bezier(.3,.7,.25,1)' }).finished;
      if (dead) return;

      // 2) a capa abre; o livro desliza para a direita para a página ficar no centro
      run(el, [{ transform: T(0, 0, 1) }, { transform: T(w / 2, 0, 1) }], { duration: OPEN, easing: ease });
      run(cover.current, [
        { transform: 'perspective(1800px) rotateY(0deg)' },
        { transform: 'perspective(1800px) rotateY(-62deg)', offset: 0.42 },
        { transform: 'perspective(1800px) rotateY(-176deg)' },
      ], { duration: OPEN, easing: ease });
      // luz passando pela capa e sombra que a capa joga na página
      run(sheen.current, [{ opacity: 0, transform: 'translateX(-60%)' }, { opacity: 0.55, offset: 0.35 }, { opacity: 0, transform: 'translateX(80%)' }], { duration: OPEN * 0.6, easing: 'ease-out' });
      const open = run(shade.current, [{ opacity: 0.85 }, { opacity: 0.5, offset: 0.4 }, { opacity: 0 }], { duration: OPEN, easing: ease });
      await open.finished;
      if (dead) return;

      // 3) mergulha na página: o leitor aparece por baixo, da mesma cor do papel
      onReveal();
      run(lines.current, [{ opacity: 1 }, { opacity: 0 }], { duration: DIVE * 0.5, easing: 'ease-out' });
      const z = run(el, [
        { transform: T(w / 2, 0, 1), opacity: 1 },
        { transform: T(0, 0, fill), opacity: 1, offset: 0.7 },
        { transform: T(0, 0, fill * 1.03), opacity: 0 },
      ], { duration: DIVE, easing: 'cubic-bezier(.55,0,.35,1)' });
      run(scrim.current, [{ opacity: 1 }, { opacity: 0 }], { duration: DIVE * 0.6, delay: DIVE * 0.4 });
      await z.finished;
      if (!dead) onDone();
    })().catch(() => { if (!dead) { onReveal(); onDone(); } });

    return () => { dead = true; anims.forEach((a) => a.cancel()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="open-layer">
      <div className="open-scrim" ref={scrim} />
      <div className="open-book" ref={wrap} style={{ '--c': book.color }}>
        <div className="open-pages" />
        <div className="open-page" style={{ background: paper }}>
          <div className="fake-lines" ref={lines} />
          <div className="open-shade" ref={shade} />
        </div>
        <div className="open-spine" />
        <div className="open-cover" ref={cover}>
          <div className="oc-front">
            <Cover book={book} loading="eager" />
            <div className="oc-sheen" ref={sheen} />
          </div>
          <div className="oc-back" />
        </div>
      </div>
    </div>
  );
}
