import app from './app';
import type { Env } from './env';
import { runDiscovery, processGithubChange } from './scanner';
import type { QueueMessage } from './types';

async function runScheduledDiscovery(env: Env) {
  const owner = env.OWNER_LOGIN?.toLowerCase();
  const row = owner
    ? await env.DB.prepare('SELECT * FROM sessions WHERE lower(github_login) = ? ORDER BY created_at DESC LIMIT 1').bind(owner).first<Record<string, string>>()
    : await env.DB.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1').first<Record<string, string>>();
  if (!row?.access_token) {
    console.log(JSON.stringify({ level: 'info', msg: 'scheduled scan skipped: no GitHub session token' }));
    return;
  }
  await runDiscovery(env, 'cron', row.access_token);
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledDiscovery(env));
  },
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    for (const message of batch.messages) {
      if (message.body.kind === 'setup-diagnostic') {
        message.ack();
        continue;
      }
      const body = message.body;
      try {
        await processGithubChange(env, body);
        message.ack();
      } catch (error) {
        console.log(JSON.stringify({ level: 'error', msg: 'queue failed', changeId: body.changeId, error: error instanceof Error ? error.message : String(error) }));
        message.retry();
      }
    }
  },
};
