import type { PeopleThread } from './types';

// Open issues and PRs that involve another person: theirs in the owner's
// repos, and the owner's in other people's repos. Who is waiting on whom
// comes from the last human to act (opening, commenting, or reviewing), so
// bots never count, and drafts are skipped because they are still in progress.

type GitHubUser = { login?: string; type?: string } | null | undefined;
type Action = { login: string; at: string };

export type PeopleCandidate = {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: GitHubUser;
  draft: boolean;
  actions: Action[];
};

const MAX_THREADS = 40;

export function isBotUser(user: GitHubUser) {
  return user?.type === 'Bot' || String(user?.login ?? '').endsWith('[bot]');
}

export function peopleThread(candidate: PeopleCandidate, ownerLogin: string): PeopleThread | null {
  if (candidate.draft || isBotUser(candidate.author)) return null;
  const owner = ownerLogin.toLowerCase();
  const actions = [...candidate.actions].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = actions.at(-1);
  if (!last) return null;
  const repoOwner = candidate.repo.split('/')[0] ?? '';
  const person = actions.filter((action) => action.login.toLowerCase() !== owner).at(-1)?.login
    ?? (repoOwner.toLowerCase() !== owner ? repoOwner : '');
  if (!person) return null;
  return {
    waitingOn: last.login.toLowerCase() === owner ? 'them' : 'you',
    person,
    repo: candidate.repo,
    number: candidate.number,
    title: candidate.title,
    url: candidate.url,
    since: last.at,
  };
}

export async function discoverPeopleThreads(headers: Record<string, string>, ownerLogin: string): Promise<PeopleThread[]> {
  const owner = ownerLogin.toLowerCase();
  const [theirs, mine] = await Promise.all([
    searchOpen(headers, `is:open user:${ownerLogin} -author:${ownerLogin} archived:false`),
    searchOpen(headers, `is:open author:${ownerLogin} -user:${ownerLogin} archived:false`),
  ]);
  const items = [...theirs, ...mine.filter((item) => repoOf(item).split('/')[0].toLowerCase() !== owner)]
    .filter((item) => !item.draft && !isBotUser(item.user))
    .slice(0, MAX_THREADS);
  const threads = await Promise.all(items.map(async (item) => peopleThread({
    repo: repoOf(item),
    number: Number(item.number),
    title: String(item.title ?? ''),
    url: String(item.html_url ?? ''),
    author: item.user,
    draft: Boolean(item.draft),
    actions: await threadActions(headers, item),
  }, ownerLogin)));
  return threads.filter((thread): thread is PeopleThread => thread !== null);
}

async function threadActions(headers: Record<string, string>, item: any): Promise<Action[]> {
  const comments = Number(item.comments ?? 0);
  const [commentList, reviews] = await Promise.all([
    comments > 0 ? getJson<any[]>(`${item.url}/comments?per_page=100&page=${Math.ceil(comments / 100)}`, headers) : [],
    item.pull_request?.url ? getJson<any[]>(`${item.pull_request.url}/reviews?per_page=100`, headers) : [],
  ]);
  const actions: Action[] = [];
  const add = (user: GitHubUser, at: string | undefined) => {
    if (user?.login && at && !isBotUser(user)) actions.push({ login: user.login, at });
  };
  add(item.user, item.created_at);
  for (const comment of commentList) add(comment.user, comment.created_at);
  for (const review of reviews) add(review.user, review.submitted_at);
  return actions;
}

async function searchOpen(headers: Record<string, string>, query: string): Promise<any[]> {
  const json = await getJson<{ items?: any[] }>(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=100`, headers);
  return json.items ?? [];
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

function repoOf(item: any) {
  return String(item.repository_url ?? '').replace('https://api.github.com/repos/', '');
}
