export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export type ActionKind =
  | 'review_requested'
  | 'assigned'
  | 'mention'
  | 'authored_pr_failing'
  | 'authored_pr_changes_requested'
  | 'authored_pr_conflict'
  | 'authored_pr_pending'
  | 'authored_pr_unverified'
  | 'stale_green_pr'
  | 'repo_missing_agent_instructions'
  | 'repo_missing_verify_command'
  | 'high_wip_warning'
  | 'commit_velocity_warning'
  | 'invitation'
  | 'security_alert'
  | 'workflow_failure'
  | 'repo_pr'
  | 'notification'
  | 'maintenance';

export type ActionSource = 'notifications' | 'search' | 'pulls' | 'checks' | 'reviews' | 'issues' | 'security' | 'commits' | 'contents' | 'actions';

export type GitHubActionItem = {
  id: string;
  canonicalSubjectKey: string;
  priority: Priority;
  kind: ActionKind;
  title: string;
  repo: string;
  url: string;
  updatedAt: string;
  reason: string;
  suggestedAction: string;
  evidence?: {
    checks?: 'success' | 'failure' | 'pending' | 'missing';
    mergeable?: 'mergeable' | 'conflicting' | 'unknown';
    hasVerificationSummary?: boolean;
    hasAgentInstructions?: boolean;
    hasVerifyCommand?: boolean;
    recentCommitCount?: number;
    recentFixCommitCount?: number;
    activeRepoCount?: number;
    author?: string;
    repoOwner?: string;
    isOwnRepo?: boolean;
    isAuthored?: boolean;
  };
  source: ActionSource;
};

export type GitHubChange = {
  id: string;
  runId: string;
  canonicalSubjectKey: string;
  sourceEndpoint: string;
  repo: string;
  subjectType: string;
  subjectUrl: string;
  htmlUrl: string;
  updatedAt: string;
  raw: Record<string, unknown>;
};

export type QueueMessage =
  | { kind: 'process-github-change'; runId: string; changeId: string }
  | { kind: 'setup-diagnostic'; diagnosticId: string; createdAt: string };

