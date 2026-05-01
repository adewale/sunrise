# GitHub fixture capture

Use this directory for redacted live GitHub API captures that characterize Sunrise discovery.

```sh
GITHUB_TOKEN=... OWNER_LOGIN=your-login node scripts/capture-github-fixtures.mjs
```

The script writes to `fixtures/github/YYYY-MM-DD/` and redacts the token. Review files before committing: remove private names, emails, tokens, or sensitive repo content.

## Manual labeling

Copy `fixtures/manual-labels.example.json` to the capture directory as `manual-labels.json` and label at least 50 candidates:

- `actionable`: whether the item truly required owner action.
- `expectedPriority`: expected P0/P1/P2/P3 classifier priority.
- `expectedKind`: expected Sunrise action kind.
- `notes`: why the label is correct.
