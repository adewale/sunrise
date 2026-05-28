import { Head, Link, type PageComponent } from '@ts-76/inertia-hono-jsx';
import type { GitHubActionItem } from '../../src/types';
import { Item, Stat, UnresolvedLink } from './_shared';

function timeSectionLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const item = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const days = Math.floor((start - item) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  return 'Older';
}

function groupedItems(items: GitHubActionItem[] = []) {
  const groups: Record<string, GitHubActionItem[]> = {};
  for (const item of items) {
    const label = timeSectionLabel(item.updatedAt);
    groups[label] = [...(groups[label] ?? []), item];
  }
  return ['Today', 'Yesterday', 'Earlier this week', 'Older', 'Earlier'].filter((label) => groups[label]?.length).map((label) => ({ label, items: groups[label] }));
}

const Dashboard: PageComponent<'Dashboard'> = (props) => {
  const p = props.pagination;
  const groups = groupedItems(props.items);
  const summary = props.refreshSummary;
  return <><Head title="Dashboard" />{summary ? <section class={`refresh-summary ${summary.status === 'no_change' ? 'quiet' : ''}`}><strong>{summary.status === 'no_change' ? 'No GitHub changes.' : 'Collected GitHub.'}</strong><span>{summary.status === 'no_change' ? 'The current snapshot matches the previous refresh.' : `${summary.candidateCount ?? 0} found · ${summary.resolvedCount ?? 0} resolved`}</span></section> : null}{props.notice ? <section class="setup-status ready">{props.notice.message}</section> : null}{props.usingFixtures ? <section class="setup-status"><strong>Test fixture mode is enabled.</strong> Dashboard items are sample data, not your live GitHub account. Remove TEST_GITHUB_FIXTURES in Cloudflare to use real GitHub data.</section> : null}<div class="dashboard-layout"><section class="inbox panel"><div class="item-list inbox-list">{groups.length ? groups.map((group) => <section class="time-section"><h2>{group.label}</h2>{group.items.map((item) => <Item item={item} ownerLogin={props.signedInAs} />)}</section>) : <div class="empty-state"><strong>All clear.</strong><p>No unresolved GitHub loops are in your inbox right now.</p></div>}</div>{p && p.totalPages > 1 ? <nav class="pagination" aria-label="Inbox pagination">{p.hasPrevious ? <Link class="button ghost" href={`/dashboard?page=${p.page - 1}`}>Newer</Link> : <span />}<span class="muted">Page {p.page} of {p.totalPages} · {p.totalItems} events · {p.pageSize} per page</span>{p.hasNext ? <Link class="button primary" href={`/dashboard?page=${p.page + 1}`}>Older</Link> : <span />}</nav> : null}</section><aside class="marginalia" aria-label="Dashboard statistics"><section class="panel stat-card unresolved-card"><p class="eyebrow">Unresolved on GitHub</p><div class="stat-list">{props.unresolvedLinks?.length ? props.unresolvedLinks.map((row) => <UnresolvedLink row={row} />) : <div class="empty-state compact"><strong>All clear.</strong><p>Nothing unresolved in the current GitHub snapshot.</p></div>}</div></section><section class="panel stat-card"><p class="eyebrow">Counts</p><div class="stat-list"><Stat label="PRs" value={props.counts.pullRequests} /><Stat label="Issues" value={props.counts.issues} /><Stat label="My PRs · own repos" value={props.counts.myPrsOwnRepos} /><Stat label="My PRs · elsewhere" value={props.counts.myPrsOtherRepos} /><Stat label="PRs to my repos" value={props.counts.prsInMyRepos} /></div></section></aside></div></>;
};

export default Dashboard;
