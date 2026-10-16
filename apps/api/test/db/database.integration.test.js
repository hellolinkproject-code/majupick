// 실제 PostgreSQL(workbridge_test) 통합 테스트. 실행: npm run test:db -w apps/api
// 이번 실행에서 만든 행(runId 표시)만 만들고 지운다. 다른 데이터는 건드리지 않는다.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/db/client.js';
import { getDatabaseConfig } from '../../src/config/database.js';

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

// 서버 메시지는 lc_messages에 따라 번역되므로 SQLSTATE(invalid_text_representation)로 판정한다.
const INVALID_TEXT_REPRESENTATION = /22P02/;

const runId = `t${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
const email = (name) => `${name}.${runId}@workbridge.test`;
const stackKey = (name) => `${runId}${name}`;

let prisma;

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the database to reject the operation');
}

function createUser(name, data = {}) {
  return prisma.user.create({ data: { email: email(name), name, ...data } });
}

function projectData(clientId, overrides = {}) {
  return {
    clientId,
    title: '쇼핑몰 리뉴얼',
    description: '통합 테스트용 프로젝트',
    category: 'WEB',
    recruitEndDate: new Date('2026-12-31'),
    budget: 5_000_000n,
    status: 'RECRUITING',
    ...overrides,
  };
}

beforeAll(async () => {
  prisma = createPrismaClient({ target: 'test' });
  const [row] = await prisma.$queryRaw`SELECT current_database() AS db`;
  if (row.db !== getDatabaseConfig('test').database || !row.db.endsWith('_test')) {
    throw new Error('Refusing to run: connected database is not the configured test database');
  }
});

afterAll(async () => {
  if (!prisma) return;
  const users = { email: { endsWith: `.${runId}@workbridge.test` } };
  await prisma.project.deleteMany({ where: { client: users } });
  await prisma.user.deleteMany({ where: users });
  await prisma.techStack.deleteMany({ where: { normalizedName: { startsWith: runId } } });
  await prisma.$disconnect();
});

describe('test database isolation', () => {
  it('connects only to workbridge_test as a non-superuser in UTC', async () => {
    const [row] = await prisma.$queryRaw`
      SELECT current_database() AS db, current_user AS "user",
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
             current_setting('TimeZone') AS tz`;

    expect(row).toEqual({
      db: 'workbridge_test',
      user: 'workbridge_app',
      superuser: false,
      tz: 'UTC',
    });
  });

  it('refuses the development database inside the test runtime and keeps the DBs distinct', () => {
    expect(() => getDatabaseConfig('development')).toThrow(/Tests must not use DATABASE_URL/);

    const devName = new URL(process.env.DATABASE_URL).pathname.slice(1);
    const testName = new URL(process.env.TEST_DATABASE_URL).pathname.slice(1);
    expect(devName).toBe('workbridge_dev');
    expect(testName).toBe('workbridge_test');
    expect(() => createPrismaClient({ target: 'development' })).toThrow();
  });

  it('has the migrated tables and the applied migration', async () => {
    const tables = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
      ORDER BY table_name`;
    const migrations = await prisma.$queryRaw`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;

    expect(tables.map((t) => t.table_name)).toEqual(EXPECTED_TABLES);
    expect(migrations.map((m) => m.migration_name)).toContain(
      '20261012083722_init_database_foundation',
    );
  });
});

describe('users', () => {
  it('creates and reads a user with its role and UTC timestamps', async () => {
    const before = Date.now();
    const created = await createUser('client-a', { role: 'CLIENT', passwordHash: 'hash' });
    const found = await prisma.user.findUnique({ where: { email: email('client-a') } });

    expect(found).toMatchObject({ id: created.id, name: 'client-a', role: 'CLIENT' });
    expect(found.createdAt).toBeInstanceOf(Date);
    expect(Math.abs(found.createdAt.getTime() - before)).toBeLessThan(60_000);

    const [raw] = await prisma.$queryRaw`
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS utc
      FROM users WHERE id = ${created.id}`;
    expect(raw.utc).toBe(found.createdAt.toISOString());
  });

  it('allows a NULL role until the user selects one and stores FREELANCER', async () => {
    const pending = await createUser('social-pending');
    const freelancer = await createUser('freelancer-role', { role: 'FREELANCER' });

    expect(pending.role).toBeNull();
    expect(pending.passwordHash).toBeNull();
    expect(freelancer.role).toBe('FREELANCER');
  });

  it('rejects a duplicate email with a unique violation', async () => {
    await createUser('dup');
    const error = await captureError(createUser('dup'));

    expect(error.code).toBe('P2002');
  });

  it('rejects an unknown role value at the database level', async () => {
    const error = await captureError(
      prisma.$executeRaw`INSERT INTO users (email, name, role)
        VALUES (${email('bad-role')}, 'bad', 'ADMIN'::user_role)`,
    );

    expect(String(error.message)).toMatch(INVALID_TEXT_REPRESENTATION);
    expect(String(error.message)).toMatch(/user_role/);
  });
});

describe('profiles', () => {
  it('links client and freelancer profiles to their users', async () => {
    const client = await createUser('client-p', {
      role: 'CLIENT',
      clientProfile: { create: { companyName: '워크브릿지', businessField: 'IT' } },
    });
    const freelancer = await createUser('freelancer-p', {
      role: 'FREELANCER',
      freelancerProfile: {
        create: { mainCategory: 'WEB', careerYears: 5, hourlyRate: 45_000n },
      },
    });

    const loadedClient = await prisma.user.findUnique({
      where: { id: client.id },
      include: { clientProfile: true },
    });
    const loadedFreelancer = await prisma.freelancerProfile.findUnique({
      where: { userId: freelancer.id },
      include: { user: true },
    });

    expect(loadedClient.clientProfile).toMatchObject({
      companyName: '워크브릿지',
      businessField: 'IT',
    });
    expect(loadedFreelancer.user.email).toBe(email('freelancer-p'));
    expect(loadedFreelancer.hourlyRate).toBe(45_000n);
  });

  it('allows only one profile per user and requires an existing user', async () => {
    const user = await createUser('one-profile', { role: 'CLIENT' });
    await prisma.clientProfile.create({ data: { userId: user.id } });

    expect(
      (await captureError(prisma.clientProfile.create({ data: { userId: user.id } }))).code,
    ).toBe('P2002');
    expect(
      (await captureError(prisma.clientProfile.create({ data: { userId: 2_000_000_000 } }))).code,
    ).toBe('P2003');
  });

  it('enforces profile CHECK constraints', async () => {
    const client = await createUser('client-check', { role: 'CLIENT' });
    const freelancer = await createUser('freelancer-check', { role: 'FREELANCER' });

    const etcWithoutField = await captureError(
      prisma.clientProfile.create({ data: { userId: client.id, businessFieldEtc: '기타 업종' } }),
    );
    const etcWithOtherField = await captureError(
      prisma.clientProfile.create({
        data: { userId: client.id, businessField: 'IT', businessFieldEtc: '기타 업종' },
      }),
    );
    const negativeCareer = await captureError(
      prisma.freelancerProfile.create({ data: { userId: freelancer.id, careerYears: -1 } }),
    );
    const zeroRate = await captureError(
      prisma.freelancerProfile.create({ data: { userId: freelancer.id, hourlyRate: 0n } }),
    );

    expect(String(etcWithoutField.message)).toMatch(/client_profiles_business_field_etc_check/);
    expect(String(etcWithOtherField.message)).toMatch(/client_profiles_business_field_etc_check/);
    expect(String(negativeCareer.message)).toMatch(/freelancer_profiles_career_years_check/);
    expect(String(zeroRate.message)).toMatch(/freelancer_profiles_hourly_rate_check/);

    const etc = await prisma.clientProfile.create({
      data: { userId: client.id, businessField: 'ETC', businessFieldEtc: '기타 업종' },
    });
    expect(etc.businessFieldEtc).toBe('기타 업종');
  });

  it('removes profiles together with the user (ON DELETE CASCADE)', async () => {
    const user = await createUser('cascade', {
      role: 'FREELANCER',
      freelancerProfile: { create: { careerYears: 1 } },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.freelancerProfile.findUnique({ where: { userId: user.id } })).toBeNull();
  });
});

describe('tech stacks', () => {
  it('connects tech stacks to freelancers and projects', async () => {
    const react = await prisma.techStack.create({
      data: { name: 'React', normalizedName: stackKey('react') },
    });
    const node = await prisma.techStack.create({
      data: { name: 'Node.js', normalizedName: stackKey('nodejs') },
    });
    const freelancer = await createUser('freelancer-ts', {
      role: 'FREELANCER',
      freelancerProfile: {
        create: { techStacks: { create: [{ techStackId: react.id }, { techStackId: node.id }] } },
      },
    });
    const client = await createUser('client-ts', { role: 'CLIENT' });
    const project = await prisma.project.create({
      data: { ...projectData(client.id), techStacks: { create: [{ techStackId: react.id }] } },
    });

    const profile = await prisma.freelancerProfile.findUnique({
      where: { userId: freelancer.id },
      include: { techStacks: { include: { techStack: true } } },
    });
    const loadedProject = await prisma.project.findUnique({
      where: { id: project.id },
      include: { techStacks: { include: { techStack: true } } },
    });

    expect(profile.techStacks.map((t) => t.techStack.name).sort()).toEqual(['Node.js', 'React']);
    expect(loadedProject.techStacks.map((t) => t.techStack.name)).toEqual(['React']);
  });

  it('rejects duplicate normalized names and duplicate links', async () => {
    const stack = await prisma.techStack.create({
      data: { name: 'Vue', normalizedName: stackKey('vue') },
    });
    const client = await createUser('client-dup-link', { role: 'CLIENT' });
    const project = await prisma.project.create({ data: projectData(client.id) });
    await prisma.projectTechStack.create({
      data: { projectId: project.id, techStackId: stack.id },
    });

    const dupName = await captureError(
      prisma.techStack.create({ data: { name: 'vue', normalizedName: stackKey('vue') } }),
    );
    const dupLink = await captureError(
      prisma.projectTechStack.create({ data: { projectId: project.id, techStackId: stack.id } }),
    );

    expect(dupName.code).toBe('P2002');
    expect(dupLink.code).toBe('P2002');
  });

  it('blocks deleting a tech stack that is in use (ON DELETE RESTRICT)', async () => {
    const stack = await prisma.techStack.create({
      data: { name: 'Svelte', normalizedName: stackKey('svelte') },
    });
    const client = await createUser('client-restrict-ts', { role: 'CLIENT' });
    await prisma.project.create({
      data: { ...projectData(client.id), techStacks: { create: [{ techStackId: stack.id }] } },
    });

    const error = await captureError(prisma.techStack.delete({ where: { id: stack.id } }));

    expect(['P2003', 'P2014']).toContain(error.code);
    expect(await prisma.techStack.findUnique({ where: { id: stack.id } })).not.toBeNull();
  });

  it('keeps a custom tech stack when its creator is deleted (ON DELETE SET NULL)', async () => {
    const creator = await createUser('stack-creator', { role: 'FREELANCER' });
    const stack = await prisma.techStack.create({
      data: {
        name: 'Astro',
        normalizedName: stackKey('astro'),
        isCustom: true,
        createdById: creator.id,
      },
    });

    await prisma.user.delete({ where: { id: creator.id } });

    const reloaded = await prisma.techStack.findUnique({ where: { id: stack.id } });
    expect(reloaded).toMatchObject({ isCustom: true, createdById: null });
  });
});

describe('projects', () => {
  it('creates and reads a project with its client relation and status enum', async () => {
    const client = await createUser('client-proj', { role: 'CLIENT' });
    const created = await prisma.project.create({
      data: projectData(client.id, { status: 'SCHEDULED' }),
    });

    const found = await prisma.project.findUnique({
      where: { id: created.id },
      include: { client: true },
    });

    expect(found).toMatchObject({ title: '쇼핑몰 리뉴얼', category: 'WEB', status: 'SCHEDULED' });
    expect(found.client.email).toBe(email('client-proj'));
    expect(found.deletedAt).toBeNull();
  });

  it('stores budgets beyond the JS safe integer range as bigint without precision loss', async () => {
    const client = await createUser('client-bigint', { role: 'CLIENT' });
    const huge = 9_007_199_254_740_993n;
    const project = await prisma.project.create({ data: projectData(client.id, { budget: huge }) });

    const found = await prisma.project.findUnique({ where: { id: project.id } });
    const [raw] =
      await prisma.$queryRaw`SELECT budget::text AS budget FROM projects WHERE id = ${project.id}`;

    expect(typeof found.budget).toBe('bigint');
    expect(found.budget).toBe(huge);
    expect(raw.budget).toBe('9007199254740993');
  });

  it('stores recruitment dates as calendar dates without time-zone shift', async () => {
    const client = await createUser('client-date', { role: 'CLIENT' });
    const project = await prisma.project.create({
      data: projectData(client.id, {
        recruitStartDate: new Date('2026-12-01'),
        recruitEndDate: new Date('2026-12-31'),
      }),
    });

    const found = await prisma.project.findUnique({ where: { id: project.id } });
    const [raw] = await prisma.$queryRaw`
      SELECT recruit_start_date::text AS start, recruit_end_date::text AS "end"
      FROM projects WHERE id = ${project.id}`;

    expect(raw).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(found.recruitStartDate.toISOString().slice(0, 10)).toBe('2026-12-01');
    expect(found.recruitEndDate.toISOString().slice(0, 10)).toBe('2026-12-31');

    const sameDay = await prisma.project.create({
      data: projectData(client.id, {
        recruitStartDate: new Date('2026-12-31'),
        recruitEndDate: new Date('2026-12-31'),
      }),
    });
    expect(sameDay.recruitStartDate.getTime()).toBe(sameDay.recruitEndDate.getTime());
  });

  it('enforces budget and recruitment date CHECK constraints', async () => {
    const client = await createUser('client-proj-check', { role: 'CLIENT' });

    const zeroBudget = await captureError(
      prisma.project.create({ data: projectData(client.id, { budget: 0n }) }),
    );
    const reversedDates = await captureError(
      prisma.project.create({
        data: projectData(client.id, {
          recruitStartDate: new Date('2027-01-02'),
          recruitEndDate: new Date('2027-01-01'),
        }),
      }),
    );

    expect(String(zeroBudget.message)).toMatch(/projects_budget_check/);
    expect(String(reversedDates.message)).toMatch(/projects_recruit_dates_check/);
  });

  it('requires an existing client and blocks deleting a client with projects', async () => {
    const missingClient = await captureError(
      prisma.project.create({ data: projectData(2_000_000_000) }),
    );
    const client = await createUser('client-restrict', { role: 'CLIENT' });
    await prisma.project.create({ data: projectData(client.id) });
    const deleteClient = await captureError(prisma.user.delete({ where: { id: client.id } }));

    expect(missingClient.code).toBe('P2003');
    expect(['P2003', 'P2014']).toContain(deleteClient.code);
    expect(await prisma.user.findUnique({ where: { id: client.id } })).not.toBeNull();
  });

  it('rejects an unknown project status at the database level', async () => {
    const client = await createUser('client-status', { role: 'CLIENT' });

    const error = await captureError(
      prisma.$executeRaw`INSERT INTO projects
        (client_id, title, description, category, recruit_end_date, budget, status, updated_at)
        VALUES (${client.id}, 't', 'd', 'WEB', DATE '2026-12-31', 1, 'DRAFT'::project_status, now())`,
    );

    expect(String(error.message)).toMatch(INVALID_TEXT_REPRESENTATION);
    expect(String(error.message)).toMatch(/project_status/);
  });
});

describe('auth tables', () => {
  it('enforces unique social accounts and refresh token hashes', async () => {
    const user = await createUser('social', { role: 'CLIENT' });
    const other = await createUser('social-other', { role: 'CLIENT' });
    const sub = `google-${runId}`;
    await prisma.socialAccount.create({
      data: {
        userId: user.id,
        provider: 'GOOGLE',
        providerUserId: sub,
        emailAtLink: email('social'),
      },
    });

    const sameGoogleAccount = await captureError(
      prisma.socialAccount.create({
        data: {
          userId: other.id,
          provider: 'GOOGLE',
          providerUserId: sub,
          emailAtLink: 'x@x.test',
        },
      }),
    );
    const secondGoogleForUser = await captureError(
      prisma.socialAccount.create({
        data: {
          userId: user.id,
          provider: 'GOOGLE',
          providerUserId: `${sub}-2`,
          emailAtLink: email('social'),
        },
      }),
    );

    const tokenHash = runId.padEnd(64, '0');
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const dupToken = await captureError(
      prisma.refreshToken.create({
        data: { userId: other.id, tokenHash, expiresAt: new Date(Date.now() + 86_400_000) },
      }),
    );

    expect(sameGoogleAccount.code).toBe('P2002');
    expect(secondGoogleForUser.code).toBe('P2002');
    expect(dupToken.code).toBe('P2002');
  });
});
