(function () {
  function visible(el, textOnly) {
    if (!el || !el.getClientRects().length) return false;
    var style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && (textOnly || style.pointerEvents !== 'none') && style.opacity !== '0';
  }
  function answer(kind, stage, seconds) {
    var result = { kind: kind, stage: stage };
    if (typeof seconds === 'number' && isFinite(seconds) && seconds >= 0) result.remainingSeconds = seconds;
    return JSON.stringify(result);
  }
  function verification(stage) {
    var clicked = document.querySelectorAll('[data-estante-clicked]');
    for (var j = 0; j < clicked.length; j++) clicked[j].removeAttribute('data-estante-clicked');
    return answer('verification', stage);
  }
  var responses = document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="cf-turnstile-response"]');
  var verified = false;
  for (var r = 0; r < responses.length; r++) {
    if ((responses[r].value || '').trim()) verified = true;
  }
  var captcha = document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, .cf-turnstile');
  if (!verified) for (var c = 0; c < captcha.length; c++) {
    if (visible(captcha[c])) return verification('Marque a verificação do hospedador para continuar o download.');
  }
  if (/just a moment|verifique que voc[eê] [eé] humano|verify you are human/i.test(document.title || '')) return verification('Conclua a verificação do hospedador para continuar o download.');
  if (/\/(login|register|upgrade)(?:[/?#]|$)/i.test(location.href)) {
    return answer('blocked', 'O hospedador exige conta ou login para este arquivo.');
  }
  var nodes = document.querySelectorAll('a, button, input[type="button"], input[type="submit"], [role="button"], [onclick]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var label = (el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().replace(/^[^a-zÀ-ÿ0-9]+/i, '');
    var free = /^(?:download\s+(?:lento|gr[aá]tis|gratuito|free)|free\s+download|baixar\s+(?:agora|gr[aá]tis|gratuito)|download\s+now)\b/i.test(label);
    // Hosts often replace the free-choice button with a plain Download label
    // after their timer finishes. Only accept short, explicit download labels.
    var finalDownload = /^(?:download|baixar)(?:\s+(?:arquivo|file))?(?:\s*\([^)]{1,60}\))?\s*$/i.test(label);
    var form = el.closest('form');
    var continueVerified = verified && form && /^(?:continuar|continue|prosseguir|enviar|submit|baixar|download)(?: download)?$/i.test(label);
    if (label.length > 160 || (!free && !finalDownload && !continueVerified && !/^downloadButton$/i.test(el.id || ''))) continue;
    if (form && /register|login|upgrade|payment|checkout|subscribe/i.test(form.getAttribute('action') || '')) continue;
    if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled')) continue;
    var href = el.getAttribute('href') || '';
    if (/(?:register|upgrade|premium|login)/i.test(href) || el.closest('[class*="premium"], [id*="premium"]')) continue;
    var signature = label + '|' + href + '|' + (el.getAttribute('onclick') || '');
    if (el.getAttribute('data-estante-clicked') === signature) continue;
    // Return ordinary file links directly: clicking a target=_blank link or a
    // signed CDN URL can otherwise be lost by the WebView navigation filter.
    if (href && !/^\s*(?:#|javascript:)/i.test(href) && !el.getAttribute('onclick')) {
      try {
        var target = new URL(href, location.href);
        var page = new URL(location.href);
        if (target.protocol === 'https:' &&
            (/\.(?:epub|pdf|cbr|cbz)$/i.test(target.pathname) || target.searchParams.has('download_token') ||
             (target.hostname !== page.hostname && !/(^|\.)(?:asdocs\.net|mediafire\.com)$/i.test(target.hostname)))) {
          return JSON.stringify({ kind: 'ready', stage: 'Baixando o arquivo liberado…', url: target.href });
        }
      } catch (ignored) { /* Leave navigation controls to the host. */ }
    }
    el.setAttribute('data-estante-clicked', signature);
    el.click();
    return answer('clicked', 'Solicitando download gratuito…');
  }
  var clocks = document.querySelectorAll('#countdown, .countdown, #seconds, .seconds, [data-seconds]');
  for (var k = 0; k < clocks.length; k++) {
    if (!visible(clocks[k], true)) continue;
    var clockText = (clocks[k].textContent || '').trim() || clocks[k].getAttribute('data-seconds') || '';
    var clock = clockText.match(/(\d+):([0-5]\d)(?::([0-5]\d))?/);
    var number = clockText.match(/\d+/);
    var seconds = clock ? (clock[3] ? +clock[1] * 3600 + +clock[2] * 60 + +clock[3] : +clock[1] * 60 + +clock[2]) : number ? +number[0] : null;
    if (seconds !== null && seconds > 0) return answer('waiting', 'Aguardando liberação do hospedador: ' + seconds + 's', seconds);
  }
  var body = document.body ? (document.body.innerText || document.body.textContent || '') : '';
  if (/aguarde|please wait|download lento/i.test(body)) return answer('waiting', 'Aguardando liberação pelo hospedador…');
  return answer('missing', 'Preparando o download no hospedador…');
})();
