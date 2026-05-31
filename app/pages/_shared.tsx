import { Link, Form } from '@ts-76/inertia-hono-jsx';
import type { GitHubActionItem } from '../../src/types';
import type { DashboardProps, SetupCheck, SetupDiagnostics } from '../../src/app';

type ActionItem = GitHubActionItem;

export function Stat({ label, value }: { label: string; value: string | number }) {
  return <p class="stat"><span>{label}</span><strong>{value}</strong></p>;
}

export function UnresolvedLink({ row }: { row: { label: string; count: number; href: string; query?: string } }) {
  return <a class="stat unresolved-link" href={row.href} target="_blank" rel="noreferrer" title={row.query ? `Opens GitHub: ${row.query}` : 'Opens GitHub'}><span>{row.label}<em>Open in GitHub</em></span><strong>{row.count} ↗</strong></a>;
}

export function SetupChecks({ checks }: { checks: SetupCheck[] }) {
  return <div class="setup-checks">{(checks ?? []).map((check) => <article class={`setup-check ${check.status}`}><span class="check-dot">{check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '×'}</span><div><strong>{check.label}</strong><p>{check.message}</p>{check.fix ? <p class="fix">{check.fix}</p> : null}</div></article>)}</div>;
}

export function SetupGuide({ setup }: { setup: SetupDiagnostics }) {
  const deployUrl = 'https://deploy.workers.cloudflare.com/?url=https://github.com/adewale/sunrise&paid=true';
  const dashboardPath = 'Workers & Pages → sunrise → Settings → Variables and Secrets';
  const steps = [
    ['Deploy your own copy', 'Use the Deploy to Cloudflare button. Cloudflare forks the repo, provisions D1 and Queues from wrangler.jsonc, runs the build, and enables deploys from your fork.'],
    ['Create a GitHub OAuth app', `Use Homepage URL ${setup.origin} and Authorization callback URL ${setup.callbackUrl}.`],
    ['Add secrets in Cloudflare', `Open ${dashboardPath}. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, OWNER_LOGIN, and SESSION_SECRET.`],
    ['Reload this page', 'The checklist verifies this instance configuration against Cloudflare, D1, Queues, and GitHub where possible.'],
    ['Sign in and refresh', 'Sign in as the configured owner, then use Manual refresh to populate the first dashboard snapshot.'],
  ];
  return <section class="panel setup"><div class="section-head"><div><p class="eyebrow">First boot</p><h2>Setup checklist</h2></div><span class="badge">{setup.ready ? 'ready' : 'action needed'}</span></div><p class={`setup-status${setup.ready ? ' ready' : ''}`}>{setup.ready ? 'Configuration looks ready. Sign in to scan GitHub.' : 'Setup needs attention. Fix failing checks below, then reload.'}</p><SetupChecks checks={setup.checks ?? []} /><div class="deploy-card"><div><strong>Start with one-click deploy</strong><p>Best for most users: no local CLI required for the first deployment.</p></div><a class="button primary" href={deployUrl}>Deploy to Cloudflare</a></div><div class="config-card"><p><span>Homepage URL</span><code>{setup.origin}</code></p><p><span>Callback URL</span><code>{setup.callbackUrl}</code></p></div><ol class="setup-steps">{steps.map(([title, copy], index) => <li><span class="step-number">{index + 1}</span><div><strong>{title}</strong><p>{copy}</p></div></li>)}</ol><p class="muted">Sunrise should never ask users to send tokens to a hosted service. OAuth secrets and GitHub data stay in the deployer’s Cloudflare account.</p></section>;
}

export function Item({ item, ownerLogin = '' }: { item: ActionItem; ownerLogin?: string }) {
  const when = formatInboxTime(item.updatedAt);
  const chips = [itemTypeLabel(item), itemRelationshipLabel(item, ownerLogin)].filter(Boolean);
  const repoOwner = item.repo.split('/')[0] || 'github';
  const author = item.evidence?.author;
  return <article class="item" id={`item-${item.id}`}><Link class="item-time" href={`/items/${encodeURIComponent(item.id)}`} title="Open this card" aria-label={`Open card updated ${when.date} ${when.time}`}><time datetime={item.updatedAt}><span>{when.date}</span><strong>{when.time}</strong></time></Link><div class="item-main"><div class="item-topline"><div class="item-signals"><span class="type-icon" aria-hidden="true">{itemIcon(item)}</span><img class="repo-avatar" src={`https://github.com/${repoOwner}.png?size=40`} alt="" loading="lazy" />{author ? <img class="author-avatar" src={`https://github.com/${author}.png?size=40`} alt="" loading="lazy" /> : null}{checkDot(item)}</div><div class="chips">{chips.map((chip) => <span class="chip">{chip}</span>)}{item.repo ? <a class="chip repo-chip" href={`https://github.com/${item.repo}`} target="_blank" rel="noreferrer">{item.repo} ↗</a> : null}</div></div><a class="item-title" href={item.url}>{item.title}</a><p>{item.reason}</p><p class="action">{item.suggestedAction} <span class="relative-time">· updated {relativeTime(item.updatedAt)}</span></p></div></article>;
}

export function DashboardHeader(props: DashboardProps) {
  const rs = props.refreshSummary;
  const summary = rs ? ` · ${rs.status === 'no_change' ? 'no GitHub changes' : `${rs.candidateCount ?? 0} found · ${rs.resolvedCount ?? 0} resolved`}` : '';
  const rate = props.rateLimit ? ` · rate limit ${props.rateLimit.remaining}` : '';
  return <div class="header-extra"><div><p class="eyebrow">{props.signedInAs} · {props.freshness.status}</p><p class="header-meta">Checked {formatDateTime(props.freshness.lastScanAt)}{summary}{rate}</p></div><div class="header-actions"><Link class="button icon-button" href="/settings" aria-label="Settings" title="Settings"><svg class="settings-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.25a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5Zm0-5 1.12 2.35 2.52.36-1.82 1.78.43 2.51L12 9.07l-2.25 1.18.43-2.51-1.82-1.78 2.52-.36L12 3.25Z" /><path d="M4.5 13.2v-2.4l2.1-.75c.18-.56.41-1.1.7-1.6L6.35 6.4l1.7-1.7 2.05.95c.5-.28 1.03-.52 1.6-.7l.75-2.1h2.4l.75 2.1c.56.18 1.1.42 1.6.7l2.05-.95 1.7 1.7-.95 2.05c.28.5.52 1.04.7 1.6l2.1.75v2.4l-2.1.75c-.18.56-.42 1.1-.7 1.6l.95 2.05-1.7 1.7-2.05-.95c-.5.29-1.04.52-1.6.7l-.75 2.1h-2.4l-.75-2.1a8.2 8.2 0 0 1-1.6-.7l-2.05.95-1.7-1.7.95-2.05a8.2 8.2 0 0 1-.7-1.6l-2.1-.75Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg></Link><Form method="post" action="/refresh" data-refresh-form>{({ processing }: { processing: boolean }) => <><button class="button primary" type="submit" data-idle-label="Manual refresh" aria-busy={processing || undefined}>{processing ? 'Refreshing...' : 'Manual refresh'}</button><span class="refresh-pending-note" role="status" aria-live="polite" hidden={!processing}>Refreshing...</span></>}</Form></div></div>;
}

export function SettingsHeader(props: { signedInAs: string }) {
  return <div class="header-extra"><div><p class="eyebrow">{props.signedInAs}</p><strong>Settings</strong><p class="header-meta">Tune your inbox rhythm.</p></div><Link class="button ghost" href="/dashboard">Inbox</Link></div>;
}

function checkDot(item: ActionItem) {
  const checks = item.evidence?.checks;
  if (!checks) return null;
  return <span class={`check-status ${checks}`} title={`Checks ${checks}`} aria-label={`Checks ${checks}`} />;
}

function formatInboxTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: '' };
  return { date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }), time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) };
}

export function formatDateTime(value: string | null) {
  if (!value) return 'not yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

function relativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const itemDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const days = Math.max(0, Math.floor((today - itemDay) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

function isPullRequestItem(item: ActionItem) { return item.url.includes('/pull/') || item.kind.includes('pr') || item.kind === 'review_requested' || item.kind === 'repo_pr'; }
function isIssueItem(item: ActionItem) { return !isPullRequestItem(item) && (item.url.includes('/issues/') || item.kind === 'assigned' || item.kind === 'maintenance' || item.source === 'issues'); }
function isAuthoredPrItem(item: ActionItem) { return item.kind.startsWith('authored_pr') || item.evidence?.isAuthored === true; }
function isOwnRepoItem(item: ActionItem, ownerLogin: string) { const repoOwner = item.repo.split('/')[0]?.toLowerCase(); return item.evidence?.isOwnRepo === true || (!!ownerLogin && repoOwner === ownerLogin.toLowerCase()); }
function itemTypeLabel(item: ActionItem) { if (isPullRequestItem(item)) return 'Pull request'; if (isIssueItem(item)) return 'Issue'; if (item.kind.includes('discussion')) return 'Discussion'; return item.kind.replaceAll('_', ' '); }
function itemRelationshipLabel(item: ActionItem, ownerLogin = '') { if (isAuthoredPrItem(item) && isPullRequestItem(item)) return isOwnRepoItem(item, ownerLogin) ? 'My PR · own repo' : 'My PR · other repo'; if (item.kind === 'repo_pr') return 'Other person’s PR · my repo'; if (item.kind === 'review_requested') return 'Review requested'; if (item.kind === 'mention') return 'Mentioned you'; if (item.kind === 'assigned') return 'Assigned to you'; if (item.kind === 'notification' && item.evidence?.notificationReason === 'subscribed') return 'Watched repo'; if (item.kind === 'maintenance') return 'Created by me'; return item.source; }
function itemIcon(item: ActionItem) { if (isPullRequestItem(item)) return '⑂'; if (isIssueItem(item)) return '○'; if (item.kind.includes('discussion')) return '◌'; if (item.kind === 'workflow_failure') return '×'; return '•'; }
export function capitalize(value: string) { return value ? value.slice(0, 1).toUpperCase() + value.slice(1) : value; }
