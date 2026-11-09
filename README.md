# 📚 Estante Livre

Biblioteca pessoal **open source** para **EPUB, PDF e HQs (CBR/CBZ)**: estante animada no estilo console com iluminação RGB, leitura offline, coletâneas e folha virando de verdade.

## Recursos

- **Estante 3D**: o livro selecionado sai da prateleira e aparece de frente no centro, com moldura RGB animada. Os vizinhos ficam em coverflow.
- **Navegação**: deslize, toque nas lombadas, use o menu lateral (Estante, Continuar lendo, Favoritos, EPUB, PDF, Coletâneas) ou a busca (`/`). No teclado: ◀ ▶, **A**/Enter para ler, **Y** para detalhes.
- **Coletâneas**: agrupe livros em box sets coloridos e organize a ordem da estante como quiser.
- **Animação de abertura**: o livro voa até o centro, a capa abre e a câmera entra na página.
- **Leitor no estilo Google Play Livros**: paginação, folha virando em 3D com o conteúdo real, sumário, marcadores, busca no livro, barra de progresso, temas (claro, sépia, escuro, preto), fonte, tamanho, entrelinha, margens e retomada de onde você parou. PDF com zoom e modo noturno.
- **Descobrir livros**:
  - *Extensões*: busca no app em eLivros, dLivros, Baixe Livros e outras fontes. Para HQs: HQ Now, Só Quadrinhos, Multiverso HQ, Tudo HQ e Mangá e Internet Archive. Downloads aceitam EPUB, PDF, CBR e CBZ; redirecionamentos e páginas intermediárias são resolvidos dentro do app quando expõem um arquivo. Sem arquivo disponível, o app informa o motivo e permite repetir a tentativa.
  - *HQ Now*: catálogo popular, pesquisa por título, sinopse e capítulos ordenados. Escolha uma edição para reunir as imagens em CBZ e ler offline no leitor de HQs. Cada capítulo tem seu próprio progresso de download e entrada na estante. A lista permite buscar capítulos e carregar mais edições.
  - *Baixar no app*: catálogo OPDS do Project Gutenberg (domínio público), com download direto para a estante. Você também pode adicionar outros catálogos OPDS.
  - *Sites*: os 77 sites de `src/data/sites.json`, com filtros por categoria, formato e situação de direitos.
  - *Por link*: cole o endereço de um EPUB, PDF, CBR ou CBZ para baixar.
- **Offline**: os livros ficam no IndexedDB do aparelho. Não precisa de conta nem de nuvem.
- **Downloads durante a leitura**: ao tocar em Baixar, o app mostra “Pronto! Pode ir ler outra coisa enquanto esperamos e baixamos para você! Assim que tiver pronto, te avisamos”. A tarefa continua ao sair de Descobrir e abrir outro livro dentro do app; ao concluir, aparece um aviso sobre o item salvo na estante. O estado do download reaparece ao voltar a Descobrir.
- **Contador no app**: um painel sobre a estante e o leitor mostra o tempo restante de liberação em minutos:segundos, quando informado pelo hospedador. Durante a transferência, calcula uma estimativa a partir do avanço medido. Na fila ou sem prazo disponível, mostra o tempo decorrido. Durante o CAPTCHA, informa que aguarda a pessoa. O painel pode ser expandido para acompanhar vários downloads. A contagem usa o horário do prazo para continuar correta ao navegar, sem declarar o arquivo pronto antes da conclusão real.
- **Coletâneas automáticas de HQs**: o segundo capítulo diferente de uma mesma HQ cria a coletânea, e os próximos entram nela em ordem numérica. O HQ Now fornece a identificação da série e do capítulo; nas outras fontes, títulos com edição explícita (como “Uma HQ #2 (2025)”) também são reconhecidos. Fontes e anos diferentes não são misturados. Repetir um capítulo substitui seu arquivo preservando a leitura, e coletâneas manuais são respeitadas.
- **Personalizar**: RGB animado ou cor única, velocidade e brilho, material da prateleira (madeira, vidro, neon, metal) e animações.

## Rodar

```bash
npm install
npm run dev        # http://localhost:5173 (use --host para abrir no celular na mesma rede)
```

## Gerar o APK

Pré-requisitos: Android SDK e JDK 21 (o JBR do Android Studio serve).

```bash
npm run android:sync              # build web + copia para android/
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Ou rode `npm run android:open` para abrir no Android Studio. O workflow em `.github/workflows/android.yml` gera o APK em cada push para `main`. Ele fica disponível em *Actions → Artifacts*.

## Sobre downloads e CORS

No **APK**, os downloads usam HTTP nativo, sem a restrição de CORS do navegador. Login, CAPTCHA, links expirados e páginas que dependem de JavaScript ainda podem exigir acesso ao hospedador. O app rejeita páginas HTML recebidas no lugar de um livro. No **navegador**, muitos sites bloqueiam download direto (CORS). No `npm run dev` existe um proxy local. Na versão web publicada, baixe o arquivo e use **Importar**.

Na versão Android 1.1, as capas também usam HTTP nativo com referer e cache. Pesquisas consultam até três fontes por vez e têm prazo de resposta, com nova tentativa. Downloads não abrem sites externos. No HQ Now, as imagens são decodificadas antes de formar o CBZ; imagens inválidas também geram erro no leitor, em vez de uma página em branco. A disponibilidade de arquivos continua dependendo do servidor de cada fonte.

Na versão Android 1.2, ASDocs e MediaFire também têm resolução dinâmica: uma WebView separada, sem acesso à ponte nativa do app, executa a página do hospedador e aciona controles gratuitos visíveis e habilitados. O tempo de espera normal é preservado e aparece no download. Ao receber o endereço do arquivo, o app baixa com a mesma sessão e valida os bytes antes de importar. Login, opções premium e verificações humanas não são completados automaticamente; o motivo aparece como erro. Essa etapa é específica do APK e tem limite de dez minutos. O fluxo real de cada hospedador, incluindo o título “Bandeira Negra”, ainda precisa ser conferido em um aparelho.

Na versão Android 1.4, uma verificação humana abre uma janela dentro do app. A pessoa marca o CAPTCHA e toca em **Continuar download**; a mesma WebView volta à preparação, preservando página, cookies e resposta da verificação. O tempo gasto nessa janela não consome o prazo de preparação. Se a resposta expirar, a janela pode ser aberta novamente. Cancelar encerra apenas aquele download e permite nova tentativa. O app não marca nem resolve o CAPTCHA automaticamente. A exibição e a aceitação do desafio real pelo hospedador ainda precisam ser conferidas no aparelho.

Execute `npm test` para verificar extensões, formatos, redirecionamentos HTTP e HTML usando um servidor local, base64 e respostas do transporte nativo, capas, imagens inválidas, concorrência e timeouts. As consultas ao HQ Now e Archive usam respostas simuladas. A disponibilidade dos sites e o fluxo completo no aparelho precisam de verificação em rede.

A extensão HQ Now consulta `https://admin.hq-now.com/graphql` por POST JSON. O contrato foi conferido na [implementação mantida pelo projeto Keiyoushi](https://github.com/keiyoushi/extensions-source/tree/main/src/pt/hqnow). Os testes usam respostas simuladas para busca, capítulos, falhas e criação do CBZ, além de verificar que o arquivo abre no leitor sem rede. A API do HQ Now não respondeu neste ambiente durante a implementação; a operação contra o serviço real ainda precisa ser validada no aparelho. O proxy de desenvolvimento encaminha POST para permitir testar essa consulta no navegador.

## Compartilhar livros por Wi-Fi e alertas de CAPTCHA (Android 1.9)

Abra os detalhes de um livro já salvo na estante e toque em **Compartilhar por Wi-Fi**. O app prepara uma cópia temporária e mostra um QR code gerado no próprio aparelho. Os dois celulares devem estar na mesma rede Wi-Fi; a transferência não consulta o hospedador original e não depende da espera dele.

No outro celular, leia o QR com a câmera e escolha **Adicionar à minha estante**. Com o Estante Livre 1.7 ou mais recente instalado, o app recebe e importa o arquivo. A página também oferece **Baixar arquivo** para quem prefere usar o navegador. O QR compartilha o livro, não o instalador do aplicativo.

Mantenha a tela de compartilhamento aberta até o recebimento terminar. O servidor publica apenas o arquivo selecionado, com endereço temporário, e encerra ao fechar a tela ou após 15 minutos. A tela permanece acesa durante o compartilhamento. Uma mudança de rede exige gerar outro QR. Redes de convidados que isolam os aparelhos podem impedir a conexão. O envio aceita arquivos de até 2 GB e precisa de espaço para uma cópia temporária.

O teste Java inicia um servidor local real e verifica os bytes transferidos, nomes, links, token da sessão, HEAD, rotas inválidas e encerramento. Os testes JavaScript cobrem preparação em partes, cancelamento, falhas, recebimento e importação. A leitura dos QR codes foi conferida com ZXing. O teste completo entre dois celulares ainda depende de validação nos aparelhos.

Durante uma espera de download que exibe a contagem regressiva, se a pessoa deixar o app em segundo plano, uma notificação avisa quando faltarem 30 segundos. Um serviço em primeiro plano mantém essa contagem ativa no HyperOS e em outros aparelhos que limitam tarefas em segundo plano. Se o CAPTCHA aparecer enquanto o app estiver em segundo plano, a notificação também a chama de volta para concluir a verificação. Permita notificações quando o Android pedir. Se já tiverem sido bloqueadas, ative-as em Configurações do celular → Aplicativos → Estante Livre → Notificações. No Xiaomi, se a contagem ainda parar em segundo plano, defina a bateria do Estante Livre como **Sem restrições**.

## Extensões do APK por JSON (Android 1.12)

O app começa sem extensões ativas. Em **Descobrir livros → Minhas extensões**, cole o JSON copiado da página independente [Extensões JSON](./extensoes-json.html). O catálogo contém 20 extensões nativas selecionadas; cada JSON ativa o adaptador correspondente do APK, preservando busca e resolução de arquivos. Só esses adaptadores catalogados podem ser importados. As extensões ficam salvas localmente e podem ser removidas nessa tela. O formato não executa código e requer esta versão do APK.

## Estrutura

```
src/lib/epub.js      parser EPUB próprio (OPF, sumário, recursos)
src/lib/engines.js   motores de leitura EPUB (colunas CSS) e PDF (pdf.js)
src/lib/flip.js      animação de folha virando
src/lib/opds.js      catálogos OPDS / Gutenberg
src/components/      Estante, Leitor, Transição, Descobrir, Organizar, Personalizar
src/data/sites.json  lista de sites (edite à vontade)
```

Respeite a licença de cada obra. A lista de sites indica a situação de direitos informada, mas ela não foi auditada.

Licença: MIT.
