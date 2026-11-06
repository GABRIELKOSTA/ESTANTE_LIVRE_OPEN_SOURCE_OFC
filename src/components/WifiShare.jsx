import { useEffect, useState } from 'react';
import { Sheet } from './Sheets.jsx';
import { getFile } from '../lib/library.js';
import { createWifiSender } from '../lib/wifi-share.js';
import { qrMatrix, qrPath } from '../lib/qr.js';

export default function WifiShare({ book, onClose, onBack }) {
  const [state, setState] = useState({ preparing: true, progress: 0 });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true, polling;
    const sender = createWifiSender();
    setState({ preparing: true, progress: 0 });
    (async () => {
      const blob = await getFile(book.id);
      if (!alive) return;
      const share = await sender.start(book, blob, progress => alive && setState({ preparing: true, progress }));
      if (!alive) return;
      const path = qrPath(qrMatrix(share.url));
      setState({ ...share, path, completed: 0 });
      polling = setInterval(async () => {
        try {
          const status = await sender.status();
          if (!alive) return;
          if (!status.active) { clearInterval(polling); setState({ error: 'O compartilhamento expirou. Gere um novo QR code.' }); }
          else setState(s => ({ ...s, completed: status.completed }));
        } catch { if (alive) { clearInterval(polling); setState({ error: 'Não foi possível consultar o envio. Tente novamente.' }); } }
      }, 2000);
    })().catch(async error => { await sender.stop().catch(() => {}); if (alive) setState({ error: error.message }); });
    return () => { alive = false; clearInterval(polling); sender.stop().catch(() => {}); };
  }, [book.id, attempt]);
  return <Sheet title="Compartilhar por Wi-Fi" onClose={onClose}>
    <div className="wifi-share">
      <h4>{book.title}</h4>
      {state.preparing && <div role="status"><p>Preparando o arquivo no aparelho… {Math.round(state.progress * 100)}%</p><progress value={state.progress} max="1" /></div>}
      {state.path && <>
        <div className="wifi-qr"><svg role="img" aria-label="QR code para receber este livro por Wi-Fi" viewBox="0 0 41 41" shapeRendering="crispEdges"><rect width="41" height="41" fill="white" /><path d={state.path} fill="black" /></svg></div>
        <p>Peça à outra pessoa para ler o QR code com a câmera do celular e tocar em <strong>Adicionar à minha estante</strong>.</p>
        <p className="muted">Os dois celulares precisam estar na mesma rede Wi-Fi. Mantenha esta tela aberta até o envio terminar. O QR code vale por 15 minutos.</p>
        <label className="field"><span>Endereço para abrir no outro aparelho</span><input aria-label="Endereço do compartilhamento" readOnly value={state.url} onFocus={e => e.target.select()} /></label>
        <p className="muted">Quem não tiver o app pode escolher “Baixar arquivo” no navegador. Se o link não abrir, verifique se o Wi-Fi permite comunicação entre os aparelhos.</p>
        {state.completed > 0 && <p className="wifi-success" role="status">Arquivo transferido {state.completed} {state.completed === 1 ? 'vez' : 'vezes'}. O outro celular pode concluir a importação.</p>}
      </>}
      {state.error && <div role="alert"><p>{state.error}</p><button className="xbtn primary" onClick={() => setAttempt(n => n + 1)}>Tentar novamente</button></div>}
      <button className="xbtn ghost" onClick={onBack}>{state.path ? 'Encerrar compartilhamento' : 'Voltar aos detalhes'}</button>
    </div>
  </Sheet>;
}
