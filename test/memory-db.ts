import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real local D1 for tests: in-memory SQLite loaded from the production migrations.
// Using the real engine (not a hand-written fake) means query semantics — WHERE
// filters, ON CONFLICT upserts, NOT NULL/UNIQUE constraints, ordering — match D1,
// so tests cannot pass against behavior the database would reject.
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const schema = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), 'utf8'))
  .join('\n');

export function createMemoryDb(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  const db = {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      let params: any[] = [];
      const api: any = {
        bind(...args: any[]) { params = args; return api; },
        async first<T = any>() { const r = stmt.get(...params) as any; return (r ? { ...r } : null) as T | null; },
        async all<T = any>() { return { results: (stmt.all(...params) as any[]).map((r) => ({ ...r })) as T[], success: true, meta: {} }; },
        async run() { const info = stmt.run(...params); return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; },
      };
      return api;
    },
  };
  return db as unknown as D1Database;
}
