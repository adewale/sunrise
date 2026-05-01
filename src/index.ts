import app from './app';
import type { Env } from './env';
import { runDiscovery, processGithubChange } from './scanner';
import type { QueueMessage } from './types';

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDiscovery(env, 'cron'));
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
