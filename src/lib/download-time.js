export function formatDuration(seconds) {
  const n = Math.max(0, Math.ceil(Number(seconds) || 0));
  const parts = [Math.floor(n / 60) % 60, n % 60].map((v) => String(v).padStart(2, '0'));
  if (n >= 3600) parts.unshift(String(Math.floor(n / 3600)).padStart(2, '0'));
  return parts.join(':');
}

export function progressTiming(previous, p, stage, details = {}, now = Date.now()) {
  let seconds = details.remainingSeconds;
  if (seconds == null && stage && /aguardando.*libera/i.test(stage)) seconds = stage.match(/(\d+)\s*s\b/)?.[1];
  seconds = seconds == null ? null : Number(seconds);
  if (!Number.isFinite(seconds) || seconds < 0) seconds = null;
  const phase = details.phase || (seconds != null ? 'waiting' : stage
    ? /verifica|captcha/i.test(stage) ? 'verification' : /outro download/i.test(stage) ? 'queued'
      : /libera/i.test(stage) ? 'waiting' : /salvando/i.test(stage) ? 'saving'
        : /baixando|transferindo/i.test(stage) ? 'downloading' : 'preparing'
    : p > 0 ? 'downloading' : previous.phase || 'preparing');
  const result = { ...previous, p, stage: stage ?? previous.stage, phase, updatedAt: now };
  const changed = phase !== previous.phase;
  if (changed) { delete result.sampleAt; delete result.sampleProgress; delete result.etaUntil; delete result.waitUntil; }
  if (phase === 'waiting') {
    if (seconds != null) result.waitUntil = now + seconds * 1000;
    else if (stage != null || details.phase) delete result.waitUntil;
  } else delete result.waitUntil;
  if (phase !== 'downloading') { delete result.etaUntil; return result; }
  if (p > 0 && p < 1) {
    if (result.sampleAt != null && now - result.sampleAt >= 1000 && p > result.sampleProgress) {
      const remaining = (1 - p) * (now - result.sampleAt) / (p - result.sampleProgress);
      if (remaining <= 86400000) result.etaUntil = now + remaining;
      result.sampleAt = now; result.sampleProgress = p;
    } else if (result.sampleAt == null || p < result.sampleProgress) {
      result.sampleAt = now; result.sampleProgress = p; delete result.etaUntil;
    }
  }
  if (p >= 1) delete result.etaUntil;
  return result;
}

export function downloadTimeLabel(job, now = Date.now()) {
  if (job.phase === 'verification') return 'Aguardando você marcar o CAPTCHA';
  if (job.waitUntil != null) return job.waitUntil > now ? `Liberação em ${formatDuration((job.waitUntil - now) / 1000)}` : 'Aguardando liberação do hospedador…';
  if (job.etaUntil > now) return `Download: cerca de ${formatDuration((job.etaUntil - now) / 1000)} restantes`;
  const elapsed = formatDuration(Math.floor(Math.max(0, now - job.startedAt) / 1000));
  if (job.phase === 'queued') return `Na fila · ${elapsed} decorridos`;
  if (job.phase === 'saving') return 'Salvando na estante…';
  if (job.p > 0 && job.p < 1) return `${Math.round(job.p * 100)}% baixado · ${elapsed} decorridos`;
  if (job.phase === 'waiting') return `Aguardando liberação · ${elapsed} decorridos (prazo não informado)`;
  return `${job.phase === 'downloading' ? 'Baixando' : 'Preparando'} · ${elapsed} decorridos`;
}
