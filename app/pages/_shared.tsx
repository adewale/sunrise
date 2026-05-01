import type { ReactNode } from 'react';

type ActionItem = {
  id: string;
  canonicalSubjectKey: string;
  kind: string;
  title: string;
  repo: string;
  url: string;
  updatedAt: string;
  reason: string;
  suggestedAction: string;
  source: string;
  evidence?: { isOwnRepo?: boolean; isAuthored?: boolean };
};

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <p className="stat"><span>{label}</span><strong>{value}</strong></p>;
}

export function SetupGuide({ setup }: { setup: any }) {
  const deployUrl = 'https://deploy.workers.cloudflare.com/?url=https://github.com/adewale/sunrise&paid=true';
  const dashboardPath = 'Workers & Pages → sunrise → Settings → Variables and Secrets';
  const steps = [
    ['Deploy your own copy', 'Use the Deploy to Cloudflare button. Cloudflare forks the repo, provisions D1 and Queues from wrangler.jsonc, runs the build, and enables deploys from your fork.'],
    ['Create a GitHub OAuth app', `Use Homepage URL ${setup.origin} and Authorization callback URL ${setup.callbackUrl}.`],
    ['Add secrets in Cloudflare', `Open ${dashboardPath}. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, OWNER_LOGIN, and SESSION_SECRET.`],
    ['Reload this page', 'The checklist verifies this instance configuration against Cloudflare, D1, Queues, and GitHub where possible.'],
    ['Sign in and refresh', 'Sign in as the configured owner, then use Manual refresh to populate the first dashboard snapshot.'],
  ];
  return <section className="panel setup"><div className="section-head"><div><p className="eyebrow">First boot</p><h2>Setup checklist</h2></div><span className="badge">{setup.ready ? 'ready' : 'action needed'}</span></div><p className={`setup-status${setup.ready ? ' ready' : ''}`}>{setup.ready ? 'Configuration looks ready. Sign in to scan GitHub.' : 'Setup needs attention. Fix failing checks below, then reload.'}</p><div className="setup-checks">{(setup.checks ?? []).map((check: any) => <article key={check.id} className={`setup-check ${check.status}`}><span className="check-dot">{check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '×'}</span><div><strong>{check.label}</strong><p>{check.message}</p>{check.fix ? <p className="fix">{check.fix}</p> : null}</div></article>)}</div><div className="deploy-card"><div><strong>Start with one-click deploy</strong><p>Best for most users: no local CLI required for the first deployment.</p></div><a className="button primary" href={deployUrl}>Deploy to Cloudflare</a></div><div className="config-card"><p><span>Homepage URL</span><code>{setup.origin}</code></p><p><span>Callback URL</span><code>{setup.callbackUrl}</code></p></div><ol className="setup-steps">{steps.map(([title, copy], index) => <li key={title}><span className="step-number">{index + 1}</span><div><strong>{title}</strong><p>{copy}</p></div></li>)}</ol><p className="muted">Sunrise should never ask users to send tokens to a hosted service. OAuth secrets and GitHub data stay in the deployer’s Cloudflare account.</p></section>;
}

export function Item({ item, ownerLogin = '' }: { item: ActionItem; ownerLogin?: string }) {
  const when = formatInboxTime(item.updatedAt);
  const chips = [itemTypeLabel(item), itemRelationshipLabel(item, ownerLogin), item.repo].filter(Boolean);
  return <article className="item"><time className="item-time" dateTime={item.updatedAt}><span>{when.date}</span><strong>{when.time}</strong></time><div className="item-main"><div className="chips">{chips.map((chip) => <span className="chip" key={chip}>{chip}</span>)}</div><a className="item-title" href={item.url}>{item.title}</a><p>{item.reason}</p><p className="action">{item.suggestedAction}</p></div></article>;
}

export function formatInboxTime(value: string) {
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

function isPullRequestItem(item: ActionItem) { return item.url.includes('/pull/') || item.kind.includes('pr') || item.kind === 'review_requested' || item.kind === 'repo_pr'; }
function isIssueItem(item: ActionItem) { return !isPullRequestItem(item) && (item.url.includes('/issues/') || item.kind === 'assigned' || item.kind === 'maintenance' || item.source === 'issues'); }
function isAuthoredPrItem(item: ActionItem) { return item.kind.startsWith('authored_pr') || item.evidence?.isAuthored === true; }
function isOwnRepoItem(item: ActionItem, ownerLogin: string) { const repoOwner = item.repo.split('/')[0]?.toLowerCase(); return item.evidence?.isOwnRepo === true || (!!ownerLogin && repoOwner === ownerLogin.toLowerCase()); }
function itemTypeLabel(item: ActionItem) { if (isPullRequestItem(item)) return 'Pull request'; if (isIssueItem(item)) return 'Issue'; return item.kind.replaceAll('_', ' '); }
function itemRelationshipLabel(item: ActionItem, ownerLogin = '') { if (isAuthoredPrItem(item)) return isOwnRepoItem(item, ownerLogin) ? 'My PR · own repo' : 'My PR · other repo'; if (item.kind === 'repo_pr') return 'Other person’s PR · my repo'; if (item.kind === 'review_requested') return 'Review requested'; if (item.kind === 'maintenance') return 'Created by me'; return item.source; }
