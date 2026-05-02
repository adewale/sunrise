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

function groupedItems(items: any[] = []) {
  const groups: Record<string, any[]> = {};
  for (const item of items) {
    const label = timeSectionLabel(item.updatedAt);
    groups[label] = [...(groups[label] ?? []), item];
  }
  return ['Today', 'Yesterday', 'Earlier this week', 'Older', 'Earlier'].filter((label) => groups[label]?.length).map((label) => ({ label, items: groups[label] }));
}

export default function Dashboard(props: any) {
  const p = props.pagination;
  const groups = groupedItems(props.items);
  const summary = props.refreshSummary;
  return <>{summary ? <section className={`refresh-summary ${summary.status === 'no_change' ? 'quiet' : ''}`}><strong>{summary.status === 'no_change' ? 'No GitHub changes.' : 'Collected GitHub.'}</strong><span>{summary.status === 'no_change' ? 'The current snapshot matches the previous refresh.' : `${summary.candidateCount ?? 0} found · ${summary.resolvedCount ?? 0} resolved`}</span></section> : null}{props.notice ? <section className="setup-status ready">{props.notice.message}</section> : null}{props.usingFixtures ? <section className="setup-status"><strong>Test fixture mode is enabled.</strong> Dashboard items are sample data, not your live GitHub account. Remove TEST_GITHUB_FIXTURES in Cloudflare to use real GitHub data.</section> : null}<div className="dashboard-layout"><section className="inbox panel"><div className="item-list inbox-list">{groups.length ? groups.map((group) => <section className="time-section" key={group.label}><h2>{group.label}</h2>{group.items.map((item: any) => <Item key={item.id} item={item} ownerLogin={props.signedInAs} />)}</section>) : <div className="empty-state"><strong>All clear.</strong><p>No unresolved GitHub loops are in your inbox right now.</p></div>}</div>{p && p.totalPages > 1 ? <nav className="pagination" aria-label="Inbox pagination">{p.hasPrevious ? <a className="button ghost" href={`/dashboard?page=${p.page - 1}`}>Newer</a> : <span /> }<span className="muted">Page {p.page} of {p.totalPages} · {p.totalItems} events · {p.pageSize} per page</span>{p.hasNext ? <a className="button primary" href={`/dashboard?page=${p.page + 1}`}>Older</a> : <span />}</nav> : null}</section><aside className="marginalia" aria-label="Dashboard statistics"><section className="panel stat-card unresolved-card"><p className="eyebrow">Unresolved on GitHub</p><div className="stat-list">{props.unresolvedLinks?.length ? props.unresolvedLinks.map((row: any) => <UnresolvedLink key={row.id} row={row} />) : <div className="empty-state compact"><strong>All clear.</strong><p>Nothing unresolved in the current GitHub snapshot.</p></div>}</div></section><section className="panel stat-card"><p className="eyebrow">Counts</p><div className="stat-list"><Stat label="PRs" value={props.counts.pullRequests} /><Stat label="Issues" value={props.counts.issues} /><Stat label="My PRs · own repos" value={props.counts.myPrsOwnRepos} /><Stat label="My PRs · elsewhere" value={props.counts.myPrsOtherRepos} /><Stat label="PRs to my repos" value={props.counts.prsInMyRepos} /></div></section></aside></div></>;
}
