import { formatDateTime, Stat } from './_shared';

export default function Runs(props: any) {
  const runs = props.runs ?? [];
  const freshness = props.freshness;
  const rate = props.rateLimit;
  const queue = props.queue;
  return <section className="section panel">{props.notice ? <p className={`setup-status${props.notice.kind === 'success' ? ' ready' : ''}`} role="status">{props.notice.message}</p> : null}<p className="eyebrow">Operations</p><h1>Runs</h1><div className="stat-list">{freshness ? <><Stat label="Freshness" value={capitalize(freshness.status)} /><Stat label="Last checked" value={formatDateTime(freshness.lastScanAt)} /></> : null}{rate ? <><Stat label="Rate limit" value={rate.remaining} /><Stat label="Rate reset" value={formatDateTime(rate.resetAt)} /></> : <Stat label="Rate limit" value="not yet" />}{queue ? <><Stat label="Queue backlog" value={queue.brokerPending ?? queue.pending} /><Stat label="Queue source" value={queue.source ?? 'd1'} /><Stat label="Queue failed" value={queue.failed} /><Stat label="DLQ" value={queue.dlq} /><Stat label="DLQ count" value={queue.dlqCount ?? 'unknown'} /></> : null}</div><table><thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Candidates</th><th>Processed</th><th>Error</th></tr></thead><tbody>{runs.map((r: any) => <tr key={r.id}><td>{formatDateTime(r.started_at)}</td><td>{r.trigger}</td><td><span className="badge">{r.status}</span></td><td>{r.candidate_count}</td><td>{r.processed_count ?? 0}</td><td>{r.error ?? ''}</td></tr>)}</tbody></table></section>;
}

function capitalize(value: string) { return value ? value[0].toUpperCase() + value.slice(1) : value; }
