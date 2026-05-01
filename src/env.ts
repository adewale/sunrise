// Cloudflare bindings come from `wrangler types` in worker-configuration.d.ts.
// Secrets are optional at type level because local tests and setup-checklist rendering
// intentionally exercise missing-secret states.
export type Env = Cloudflare.Env & {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  OWNER_LOGIN?: string;
  SESSION_SECRET?: string;
  GITHUB_OAUTH_SCOPES?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  GITHUB_QUEUE_NAME?: string;
  GITHUB_QUEUE_DLQ_NAME?: string;
  TEST_GITHUB_FIXTURES?: string;
};
