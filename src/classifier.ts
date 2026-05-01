import type { ActionKind, ActionSource, GitHubActionItem, GitHubChange, Priority } from './types';

const priorityRank: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const directnessRank: Record<ActionKind, number> = {
  review_requested: 0,
  assigned: 0,
  authored_pr_failing: 1,
  authored_pr_conflict: 1,
  authored_pr_changes_requested: 1,
  authored_pr_unverified: 2,
  stale_green_pr: 2,
  mention: 3,
  security_alert: 0,
  workflow_failure: 0,
  invitation: 0,
  repo_pr: 2,
  authored_pr_pending: 4,
  repo_missing_verify_command: 5,
  repo_missing_agent_instructions: 5,
  repo_missing_reality_manifest: 5,
  high_wip_warning: 6,
  commit_velocity_warning: 6,
  maintenance: 7,
  notification: 8,
};

export function classifyChange(change: GitHubChange, ownerLogin: string): GitHubActionItem | null {
  const raw = change.raw;
  const reason = String(raw.reason ?? '').toLowerCase();
  const title = String(raw.title ?? change.subjectType);
  const source = mapSource(change.sourceEndpoint);
  const evidence = {
    checks: raw.checks as 'success' | 'failure' | 'pending' | 'missing' | undefined,
    mergeable: raw.mergeable as 'mergeable' | 'conflicting' | 'unknown' | undefined,
    hasVerificationSummary: raw.hasVerificationSummary as boolean | undefined,
    hasAgentInstructions: raw.hasAgentInstructions as boolean | undefined,
    hasVerifyCommand: raw.hasVerifyCommand as boolean | undefined,
    hasRealityManifest: raw.hasRealityManifest as boolean | undefined,
    recentCommitCount: raw.recentCommitCount as number | undefined,
    recentFixCommitCount: raw.recentFixCommitCount as number | undefined,
    activeRepoCount: raw.activeRepoCount as number | undefined,
    author: raw.author as string | undefined,
    repoOwner: raw.repoOwner as string | undefined,
    isOwnRepo: raw.isOwnRepo as boolean | undefined,
    isAuthored: raw.isAuthored as boolean | undefined,
  };

  const make = (priority: Priority, kind: ActionKind, why: string, action: string): GitHubActionItem => ({
    id: change.id,
    canonicalSubjectKey: change.canonicalSubjectKey,
    priority,
    kind,
    title,
    repo: change.repo,
    url: change.htmlUrl,
    updatedAt: change.updatedAt,
    reason: why,
    suggestedAction: action,
    evidence: compactEvidence(evidence),
    source,
  });

  if (reason === 'review_requested' || change.sourceEndpoint.includes('review-requests')) return make('P0', 'review_requested', 'Your review is requested.', 'Review this PR');
  if (reason === 'assign') return make('P0', 'assigned', 'This issue or PR is assigned to you.', 'Respond or unassign yourself');
  if (reason === 'mention' || reason === 'team_mention' || change.sourceEndpoint.includes('mentions')) return make('P1', 'mention', 'You were mentioned directly.', 'Reply to mention');
  if (reason === 'security_alert') return make('P0', 'security_alert', 'GitHub reported a security alert.', 'Triage security alert');
  if (change.sourceEndpoint.includes('workflow-failure')) return make('P0', 'workflow_failure', 'A workflow failed in one of your repositories.', 'Open the failed run and repair the breakage');
  if (change.sourceEndpoint.includes('invitations')) return make('P0', 'invitation', 'A repository or organization invitation is pending.', 'Accept or decline invitation');
  if (change.sourceEndpoint.includes('owned-repo-prs')) return make('P2', 'repo_pr', 'An open PR targets one of your repositories.', 'Review or triage this PR');

  const isAuthored = String(raw.author ?? '').toLowerCase() === ownerLogin.toLowerCase() || change.sourceEndpoint.includes('authored-prs');
  if (isAuthored && raw.checks === 'failure') return make('P0', 'authored_pr_failing', 'Your authored PR has failing checks.', 'Fix failing checks');
  if (isAuthored && raw.mergeable === 'conflicting') return make('P0', 'authored_pr_conflict', 'Your authored PR has merge conflicts.', 'Rebase or resolve conflicts');
  if (isAuthored && raw.latestReviewState === 'CHANGES_REQUESTED') return make('P0', 'authored_pr_changes_requested', 'A reviewer requested changes on your PR.', 'Address requested changes');
  if (isAuthored && raw.checks === 'pending') return make('P2', 'authored_pr_pending', 'Your authored PR is waiting on pending checks or review.', 'Nudge reviewers or update PR');
  if (isAuthored && raw.checks === 'success' && raw.hasVerificationSummary === false) return make('P0', 'authored_pr_unverified', 'Your authored PR is green but lacks verification evidence.', 'Add verification summary or run the declared verify command');
  if (isAuthored && raw.staleGreen === true) return make('P2', 'stale_green_pr', 'Your authored PR is green and stale.', 'Merge or close this green PR');

  if (change.subjectType === 'Repository' && raw.hasAgentInstructions === false) return make('P2', 'repo_missing_agent_instructions', 'Active repo lacks repo-local agent instructions.', 'Add AGENTS.md/CLAUDE.md with verification commands and project constraints');
  if (change.subjectType === 'Repository' && raw.hasVerifyCommand === false) return make('P2', 'repo_missing_verify_command', 'Active repo lacks one obvious verification command.', 'Add one obvious verify command for agents and humans');
  if (change.subjectType === 'Repository' && raw.hasRealityManifest === false) return make('P2', 'repo_missing_reality_manifest', 'Project lacks a reality manifest for real inputs and repair paths.', 'Capture real inputs, outputs, limits, failure modes, and repair path');
  if (change.subjectType === 'WipSummary' && Number(raw.activeRepoCount ?? 0) > Number(raw.wipLimit ?? 3)) return make('P2', 'high_wip_warning', 'Recent work spans more active repos than the configured WIP limit.', 'Choose active repos and archive/defer the rest');
  if (Number(raw.recentFixCommitCount ?? 0) >= 3) return make('P2', 'commit_velocity_warning', 'Repeated fix/stabilize/harden commits suggest verification debt.', 'Stop and characterize before more feature work');

  if (reason === 'author' || change.sourceEndpoint.includes('created-issues')) return make('P2', 'maintenance', 'A thread you opened has activity or needs closure.', 'Respond, close, or archive this loop');
  if (reason === 'comment') return make('P3', 'notification', 'A subscribed thread has new activity.', 'Review if still relevant');
  if (reason === 'subscribed' || reason === 'state_change') return make('P3', 'notification', 'Low-priority GitHub notification.', 'Review or ignore');
  return null;
}

export function dedupeActionItems(items: GitHubActionItem[]): GitHubActionItem[] {
  const byKey = new Map<string, GitHubActionItem>();
  for (const item of items) {
    const existing = byKey.get(item.canonicalSubjectKey);
    if (!existing || compareItems(item, existing) < 0) byKey.set(item.canonicalSubjectKey, item);
  }
  return [...byKey.values()];
}

export function rankActionItems(items: GitHubActionItem[]): GitHubActionItem[] {
  return [...items].sort(compareItems);
}

export function compareItems(a: GitHubActionItem, b: GitHubActionItem): number {
  return priorityRank[a.priority] - priorityRank[b.priority]
    || directnessRank[a.kind] - directnessRank[b.kind]
    || loopRisk(b) - loopRisk(a)
    || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function loopRisk(item: GitHubActionItem): number {
  if (['authored_pr_failing', 'authored_pr_conflict', 'authored_pr_changes_requested'].includes(item.kind)) return 4;
  if (['authored_pr_unverified', 'stale_green_pr'].includes(item.kind)) return 3;
  if (['high_wip_warning', 'commit_velocity_warning'].includes(item.kind)) return 2;
  return 1;
}

function compactEvidence(e: GitHubActionItem['evidence']) {
  const out = Object.fromEntries(Object.entries(e ?? {}).filter(([, value]) => value !== undefined));
  return Object.keys(out).length ? out : undefined;
}

function mapSource(endpoint: string): ActionSource {
  if (endpoint.includes('notification')) return 'notifications';
  if (endpoint.includes('pull')) return 'pulls';
  if (endpoint.includes('check')) return 'checks';
  if (endpoint.includes('review')) return 'reviews';
  if (endpoint.includes('issue')) return 'issues';
  if (endpoint.includes('security')) return 'security';
  if (endpoint.includes('commit')) return 'commits';
  if (endpoint.includes('content')) return 'contents';
  if (endpoint.includes('action')) return 'actions';
  return 'search';
}
