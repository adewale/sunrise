// Augment Cloudflare.Env (from wrangler types / worker-configuration.d.ts) with
// optional vars/secrets that aren't declared in wrangler.jsonc. Marking them
// optional lets local setup-checklist rendering and the workers-pool tests
// exercise missing/varied values without `as any`.
declare global {
  namespace Cloudflare {
    interface Env {
      GITHUB_CLIENT_ID?: string;
      GITHUB_CLIENT_SECRET?: string;
      OWNER_LOGIN?: string;
      SESSION_SECRET?: string;
      GITHUB_OAUTH_SCOPES?: string;
      CLOUDFLARE_ACCOUNT_ID?: string;
      CLOUDFLARE_API_TOKEN?: string;
      GITHUB_QUEUE_NAME?: string;
      GITHUB_QUEUE_DLQ_NAME?: string;
      PROJECT_LANDING?: string;
      TEST_GITHUB_FIXTURES?: string;
    }
  }
}

export type Env = Cloudflare.Env;
