// 로컬 DB 연결 점검(읽기 전용). 접속 URL·비밀번호는 출력하지 않는다.
//   npm run db:check -w apps/api
import pg from 'pg';
import {
  DatabaseConfigError,
  describeDatabase,
  getDatabaseConfig,
} from '../src/config/database.js';

const EXPECTED_TABLES = [
  'ai_budget_months',
  'ai_usage_ledger',
  'applications',
  'bookmarks',
  'client_profiles',
  'freelancer_profiles',
  'freelancer_tech_stacks',
  'notifications',
  'oauth_transactions',
  'project_tech_stacks',
  'projects',
  'refresh_tokens',
  'social_accounts',
  'tech_stacks',
  'users',
];

async function inspect(info) {
  const client = new pg.Client({ connectionString: info.url });
  await client.connect();
  try {
    const {
      rows: [meta],
    } = await client.query(
      `SELECT current_database() AS db, current_user AS "user",
              current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`,
    );
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const tables = rows.map((row) => row.table_name);
    const domainTables = EXPECTED_TABLES.filter((name) => tables.includes(name));
    return { ...meta, tables, domainTables };
  } finally {
    await client.end();
  }
}

let failed = false;
for (const target of ['development', 'test', 'shadow']) {
  let info;
  try {
    info = getDatabaseConfig(target);
  } catch (error) {
    failed = true;
    const reason = error instanceof DatabaseConfigError ? error.message : 'invalid configuration';
    console.log(`✖ ${target.padEnd(11)} ${reason}`);
    continue;
  }
  try {
    const result = await inspect(info);
    const tableNote =
      target === 'shadow'
        ? `tables=${result.tables.length}`
        : `workbridge tables=${result.domainTables.length}/${EXPECTED_TABLES.length}, all tables=${result.tables.length}`;
    console.log(
      `✔ ${target.padEnd(11)} ${describeDatabase(info)} user=${result.user} superuser=${result.superuser} ` +
        `PostgreSQL ${result.version} TimeZone=${result.timezone} ${tableNote}`,
    );
  } catch (error) {
    failed = true;
    console.log(
      `✖ ${target.padEnd(11)} ${describeDatabase(info)} connection failed: ${error.code ?? error.message}`,
    );
  }
}
process.exit(failed ? 1 : 0);
