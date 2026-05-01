# OAuth scope reality check

Date: 2026-05-01

Default Sunrise OAuth scope:

```txt
read:user user:email notifications
```

This supports public-account owner sign-in and notification/search discovery for public repositories.

Optional private-repository scope:

```txt
read:user user:email notifications repo
```

Set with `GITHUB_OAUTH_SCOPES` only when the owner wants private repository discovery.

## Endpoint expectations

| Endpoint group | Default scope | With `repo` | Notes |
|---|---|---|---|
| `/user` | yes | yes | Owner identity check. |
| `/notifications` | yes | yes | Requires notifications scope. |
| `/search/issues` public repos | yes | yes | Public issues/PRs visible to token. |
| private repo issue/PR search | no/partial | yes | Needs private repo access. |
| `/user/repos?affiliation=owner` public repos | partial | yes | Private repos require `repo`. |
| PR reviews/statuses/check-runs public repos | yes if visible | yes | Check-runs may fail on repos not visible to token. |
| repository invitations | partial | yes | Depends on GitHub API permissions/account state. |
| org memberships | partial | yes | Depends on org visibility. |
| Dependabot/code/secret scanning alerts | often no | yes plus repo/admin visibility | GitHub may still require repo-specific permissions or security access. |
| repo contents readiness checks | public only | yes | Private contents require `repo`. |

## Reality-check procedure

1. Sign in with default scopes.
2. Run Manual refresh.
3. Open `/runs` and `/setup?json`.
4. Capture endpoint failures from Worker logs.
5. Repeat with `GITHUB_OAUTH_SCOPES="read:user user:email notifications repo"`.
6. Record which endpoint groups changed from 403/404/empty to useful results.

Do not make `repo` a deploy-button prompt. Keep it as an explicit owner opt-in for private repository discovery.
