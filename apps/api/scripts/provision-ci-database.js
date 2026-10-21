// GitHub Actions의 일회용 PostgreSQL 서비스만 준비한다.
// workbridge_dev 또는 workbridge_shadow가 이미 있는 서버는 변경하지 않고 거부한다.
// 비밀번호와 접속 URL은 출력하지 않는다.
import pg from 'pg';

const APP_ROLE = 'workbridge_app';
const TEST_DB = 'workbridge_test';
const ADMIN_USER = 'postgres';
const ADMIN_DB = 'postgres';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function refuse(message) {
  const error = new Error(message);
  error.expose = true;
  throw error;
}

function assertProvisionAllowed() {
  if (process.env.WORKBRIDGE_CI_PROVISION !== 'true') {
    refuse('refusing: WORKBRIDGE_CI_PROVISION=true is required');
  }
  if (process.env.NODE_ENV !== 'test') {
    refuse('refusing: NODE_ENV must be test');
  }
  if (process.env.ALLOW_REMOTE_DATABASE === 'true') {
    refuse('refusing: ALLOW_REMOTE_DATABASE must stay false');
  }
  if (process.env.PGOPTIONS || process.env.PGTZ) {
    refuse('refusing: PGOPTIONS or PGTZ would override the database TimeZone');
  }
}

function readTestTarget() {
  const raw = process.env.TEST_DATABASE_URL;
  const appPassword = process.env.CI_APP_PASSWORD;
  const adminPassword = process.env.CI_POSTGRES_PASSWORD;
  if (!raw || !appPassword || !adminPassword) {
    refuse('refusing: TEST_DATABASE_URL, CI_APP_PASSWORD, and CI_POSTGRES_PASSWORD are required');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    refuse('refusing: TEST_DATABASE_URL is not a valid URL');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    refuse('refusing: TEST_DATABASE_URL must use postgresql://');
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    refuse('refusing: TEST_DATABASE_URL host is not local');
  }
  if (url.username !== APP_ROLE) {
    refuse('refusing: tests must connect as workbridge_app');
  }
  if (decodeURIComponent(url.pathname.replace(/^\//, '')) !== TEST_DB) {
    refuse('refusing: tests must use workbridge_test');
  }
  if ([...url.searchParams.keys()].length > 0) {
    refuse('refusing: TEST_DATABASE_URL must not include connection options');
  }

  let password;
  try {
    password = decodeURIComponent(url.password);
  } catch {
    refuse('refusing: TEST_DATABASE_URL password encoding is invalid');
  }
  if (password !== appPassword) {
    refuse('refusing: TEST_DATABASE_URL password does not match CI_APP_PASSWORD');
  }

  return {
    host: url.hostname === '[::1]' ? '::1' : url.hostname,
    port: Number(url.port || '5432'),
    appPassword,
    adminPassword,
    connectionString: raw,
  };
}

async function applyRolePassword(client, exists, password) {
  const template = exists
    ? 'ALTER ROLE workbridge_app WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
    : 'CREATE ROLE workbridge_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  let rows;
  try {
    ({ rows } = await client.query('SELECT format($1::text, $2::text) AS stmt', [
      template,
      password,
    ]));
  } catch (error) {
    refuse(`role statement build failed (${error.code ?? 'unknown'})`);
  }
  try {
    await client.query(rows[0].stmt);
  } catch (error) {
    refuse(`role update failed (${error.code ?? 'unknown'})`);
  }
}

async function main() {
  assertProvisionAllowed();
  const target = readTestTarget();
  const admin = new pg.Client({
    host: target.host,
    port: target.port,
    user: ADMIN_USER,
    password: target.adminPassword,
    database: ADMIN_DB,
  });

  await admin.connect();
  try {
    const { rows: localDatabases } = await admin.query(
      'SELECT datname FROM pg_database WHERE datname = ANY($1::text[])',
      [['workbridge_dev', 'workbridge_shadow']],
    );
    if (localDatabases.length > 0) {
      refuse('refusing: server already has a local WorkBridge database');
    }

    const { rows: roles } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
      APP_ROLE,
    ]);
    await applyRolePassword(admin, roles.length > 0, target.appPassword);

    const { rows: databases } = await admin.query(
      'SELECT pg_catalog.pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1',
      [TEST_DB],
    );
    if (databases.length === 0) {
      await admin.query(`CREATE DATABASE ${TEST_DB} OWNER ${APP_ROLE}`);
    } else if (databases[0].owner !== APP_ROLE) {
      await admin.query(`ALTER DATABASE ${TEST_DB} OWNER TO ${APP_ROLE}`);
    }
    await admin.query(`ALTER DATABASE ${TEST_DB} SET timezone TO 'UTC'`);
    await admin.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${TEST_DB} TO ${APP_ROLE}`);
  } finally {
    await admin.end().catch(() => {});
  }

  const maintainer = new pg.Client({
    host: target.host,
    port: target.port,
    user: ADMIN_USER,
    password: target.adminPassword,
    database: TEST_DB,
  });
  await maintainer.connect();
  try {
    const { rows: schemaRows } = await maintainer.query(
      `SELECT has_schema_privilege($1, n.oid, 'USAGE') AS can_use,
              has_schema_privilege($1, n.oid, 'CREATE') AS can_create
         FROM pg_namespace n
        WHERE n.nspname = 'public'`,
      [APP_ROLE],
    );
    const schema = schemaRows[0];
    if (!schema?.can_use || !schema?.can_create) {
      await maintainer.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${APP_ROLE}`);
    }
    const { rows: rechecked } = await maintainer.query(
      `SELECT has_schema_privilege($1, n.oid, 'USAGE') AS can_use,
              has_schema_privilege($1, n.oid, 'CREATE') AS can_create
         FROM pg_namespace n
        WHERE n.nspname = 'public'`,
      [APP_ROLE],
    );
    if (!rechecked[0]?.can_use || !rechecked[0]?.can_create) {
      refuse('refusing: workbridge_app cannot create objects in schema public');
    }

    const { rows: flags } = await maintainer.query(
      `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolconfig
         FROM pg_roles WHERE rolname = $1`,
      [APP_ROLE],
    );
    const role = flags[0];
    if (
      !role?.rolcanlogin ||
      role.rolsuper ||
      role.rolcreatedb ||
      role.rolcreaterole ||
      role.rolreplication ||
      role.rolbypassrls
    ) {
      refuse('refusing: workbridge_app is not a non-admin login role');
    }
    const config = role.rolconfig ?? [];
    if (config.some((item) => String(item).toLowerCase().startsWith('timezone='))) {
      refuse('refusing: workbridge_app role TimeZone would override the database setting');
    }
  } finally {
    await maintainer.end().catch(() => {});
  }

  const app = new pg.Client({ connectionString: target.connectionString });
  await app.connect();
  try {
    const { rows } = await app.query(
      `SELECT current_database() AS db,
              current_user AS "user",
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
              current_setting('TimeZone') AS tz,
              (SELECT source FROM pg_settings WHERE name = 'TimeZone') AS tz_source`,
    );
    const session = rows[0];
    if (session?.db !== TEST_DB || session.user !== APP_ROLE || session.superuser !== false) {
      refuse('refusing: test session is not workbridge_test as non-superuser workbridge_app');
    }
    if (session.tz !== 'UTC' || session.tz_source !== 'database') {
      refuse(`refusing: TimeZone is ${session.tz} from ${session.tz_source}`);
    }
    console.log(
      `[ci-db] ready db=${session.db} user=${session.user} superuser=false tz=${session.tz} source=${session.tz_source}`,
    );
  } finally {
    await app.end().catch(() => {});
  }
}

main().catch((error) => {
  const message = error?.expose
    ? error.message
    : error?.code
      ? `database error ${error.code}`
      : 'provision failed';
  console.error(`[ci-db] ${message}`);
  process.exit(1);
});
