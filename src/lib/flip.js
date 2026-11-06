// Animação de folha virando, usando "fotos" (clones) da página atual e da nova.
//  próxima:  [nova] <- folha(atual) gira 0 → -180° em torno da lombada (esquerda)
//  anterior: [nova] <- cópia(atual) <- folha(nova) gira -180° → 0
let busy = false;
export const isFlipping = () => busy;

function makeLeaf(content, paper) {
  const leaf = document.createElement('div');
  leaf.className = 'leaf';
  const front = document.createElement('div');
  front.className = 'leaf-face leaf-front';
  front.style.background = paper;
  front.appendChild(content);
  const shade = document.createElement('div');
  shade.className = 'leaf-shade';
  front.appendChild(shade);
  const back = document.createElement('div');
  back.className = 'leaf-face leaf-back';
  back.style.background = paper;
  leaf.append(front, back);
  return { leaf, shade };
}

/**
 * @param stage      elemento que contém a página (position: relative)
 * @param dir        1 = próxima, -1 = anterior
 * @param snapCurrent () => Node  cópia da página visível
 * @param apply      async () => void  muda a página real para a nova
 * @param snapNew    () => Node  cópia da nova página (após apply)
 */
export async function flipPage({ stage, dir, snapCurrent, apply, snapNew, paper = '#fff', duration = 620, enabled = true }) {
  if (busy) return false;
  if (!enabled || matchMedia('(prefers-reduced-motion: reduce)').matches) { await apply(); return true; }
  busy = true;
  const temporary = [];
  const easing = 'cubic-bezier(.45,.05,.25,1)';
  try {
    const current = snapCurrent();
    if (dir > 0) {
      const { leaf, shade } = makeLeaf(current, paper);
      temporary.push(leaf);
      stage.appendChild(leaf);
      await apply();
      const ground = document.createElement('div');
      temporary.push(ground);
      ground.className = 'leaf-ground';
      stage.appendChild(ground);
      const a = leaf.animate([
        { transform: 'perspective(2200px) rotateY(0deg)' },
        { transform: 'perspective(2200px) rotateY(-95deg) skewY(-1.5deg)', offset: 0.55 },
        { transform: 'perspective(2200px) rotateY(-180deg)' },
      ], { duration, easing, fill: 'forwards' });
      shade.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.5 }, { opacity: 0.9 }], { duration, easing, fill: 'forwards' });
      ground.animate([{ opacity: 0.0, transform: 'scaleX(1)' }, { opacity: 0.5, offset: 0.4 }, { opacity: 0, transform: 'scaleX(0)' }], { duration, easing, fill: 'forwards' });
      await a.finished;
      leaf.remove(); ground.remove();
    } else {
      const cover = document.createElement('div');
      temporary.push(cover);
      cover.className = 'leaf-static';
      cover.style.background = paper;
      cover.appendChild(current);
      stage.appendChild(cover);
      await apply();
      const { leaf, shade } = makeLeaf(snapNew(), paper);
      temporary.push(leaf);
      leaf.style.transform = 'perspective(2200px) rotateY(-180deg)';
      stage.appendChild(leaf);
      const a = leaf.animate([
        { transform: 'perspective(2200px) rotateY(-180deg)' },
        { transform: 'perspective(2200px) rotateY(-85deg) skewY(1.5deg)', offset: 0.45 },
        { transform: 'perspective(2200px) rotateY(0deg)' },
      ], { duration, easing, fill: 'forwards' });
      shade.animate([{ opacity: 0.9 }, { opacity: 0.5, offset: 0.5 }, { opacity: 0 }], { duration, easing, fill: 'forwards' });
      await a.finished;
      leaf.remove(); cover.remove();
    }
  } finally {
    temporary.forEach((node) => node.remove());
    busy = false;
  }
  return true;
}
