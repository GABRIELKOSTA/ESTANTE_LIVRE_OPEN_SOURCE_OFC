import { useEffect, useState } from 'react';
import { downloadTimeLabel } from '../lib/download-time.js';
import { Icon } from './Icons.jsx';

function useClock(active) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return Date.now();
}

export function DownloadStatus({ job }) {
  const now = useClock(!job.done && !job.error);
  return <span role="timer" aria-live="off">{downloadTimeLabel(job, now)}</span>;
}

export default function DownloadMonitor({ jobs, withToast }) {
  const [expanded, setExpanded] = useState(false);
  const active = Object.entries(jobs).filter(([, job]) => !job.done && !job.error);
  const now = useClock(active.length > 0);
  if (!active.length) return null;
  return <section className={'download-monitor' + (withToast ? ' notice-visible' : '')} aria-label="Andamento dos downloads">
    <button className="download-monitor-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
      <Icon name="download" size={18} />
      <span><strong>{active.length === 1 ? active[0][1].title : `${active.length} downloads em andamento`}</strong>
        <small role="timer" aria-live="off">{downloadTimeLabel(active[0][1], now)}</small></span>
      <span aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div className="download-monitor-list">{active.map(([key, job]) => <div key={key}>
      <strong>{job.title}</strong><span role="timer" aria-live="off">{downloadTimeLabel(job, now)}</span>
      {job.p > 0 && job.p < 1 && <progress value={job.p} max="1" aria-label={`Download de ${job.title}`} />}
    </div>)}</div>}
  </section>;
}
