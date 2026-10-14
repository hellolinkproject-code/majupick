import { describe, expect, it, vi } from 'vitest';
import {
  createBookmarkService,
  MY_BOOKMARKS_PAGE_SIZE,
  toBookmarkItem,
} from '../src/modules/bookmarks/bookmark.service.js';
import {
  RECOMMENDATION_LIMIT,
  rankRecommendations,
} from '../src/modules/projects/projectRecommendations.js';
import { PUBLIC_PROJECT_WHERE } from '../src/modules/projects/projectStatus.js';

const date = (day) => new Date(`${day}T00:00:00.000Z`);

function projectRow(overrides = {}) {
  return {
    id: 7,
    title: '북마크 대상',
    description: '설명 '.repeat(50),
    category: 'WEB',
    budget: 9_007_199_254_740_993n,
    recruitStartDate: null,
    recruitEndDate: date('2026-10-20'),
    status: 'RECRUITING',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    techStacks: [
      { techStack: { id: 2, name: 'React' } },
      { techStack: { id: 1, name: 'Node.js' } },
    ],
    _count: { applications: 3 },
    applications: [],
    ...overrides,
  };
}

describe('toBookmarkItem', () => {
  it('keeps the budget exact and adds the save time and the freelancer’s own application', () => {
    const bookmarkedAt = new Date('2026-10-14T01:00:00Z');
    const item = toBookmarkItem(
      {
        createdAt: bookmarkedAt,
        project: projectRow({ applications: [{ id: 31, status: 'PENDING' }] }),
      },
      '2026-10-14',
    );
    expect(item).toMatchObject({
      id: 7,
      budget: '9007199254740993',
      publicStatus: 'RECRUITING',
      isBookmarked: true,
      bookmarkedAt,
      myApplication: { id: 31, status: 'PENDING' },
      techStacks: [
        { id: 1, name: 'Node.js' },
        { id: 2, name: 'React' },
      ],
    });
    expect(item.descriptionPreview.length).toBeLessThanOrEqual(121);
  });

  it('shows the status as of today (KST) so a past deadline is never shown as recruiting', () => {
    const item = toBookmarkItem({ createdAt: new Date(), project: projectRow() }, '2026-10-21');
    expect(item.publicStatus).toBe('CLOSED');
    expect(item.myApplication).toBeNull();
  });

  it('hides trade states and leaves out owner and client fields', () => {
    const item = toBookmarkItem(
      { createdAt: new Date(), project: projectRow({ status: 'IN_PROGRESS', clientId: 99 }) },
      '2026-10-14',
    );
    expect(item.publicStatus).toBe('CLOSED');
    for (const key of [
      'status',
      'client',
      'clientId',
      'description',
      'applications',
      'deletedAt',
    ]) {
      expect(item).not.toHaveProperty(key);
    }
  });
});

describe('bookmark service', () => {
  function fakePrisma({ project = { id: 7 } } = {}) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      project: { findFirst: vi.fn().mockResolvedValue(project) },
      bookmark: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    return {
      tx,
      $transaction: vi.fn((arg) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
      bookmark: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        count: vi.fn().mockResolvedValue(11),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
  }

  it('adds with ON CONFLICT DO NOTHING after checking the public scope under a row lock', async () => {
    const prisma = fakePrisma();
    await createBookmarkService({ prisma }).addBookmark(5, 7);
    expect(prisma.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.tx.project.findFirst).toHaveBeenCalledWith({
      where: { id: 7, ...PUBLIC_PROJECT_WHERE },
      select: { id: true },
    });
    expect(prisma.tx.bookmark.createMany).toHaveBeenCalledWith({
      data: [{ userId: 5, projectId: 7 }],
      skipDuplicates: true,
    });
  });

  it('refuses a deleted, cancelled or missing project with 404 and writes nothing', async () => {
    const prisma = fakePrisma({ project: null });
    await expect(createBookmarkService({ prisma }).addBookmark(5, 7)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(prisma.tx.bookmark.createMany).not.toHaveBeenCalled();
  });

  it('removes only the caller’s own row and never touches the project', async () => {
    const prisma = fakePrisma();
    await createBookmarkService({ prisma }).removeBookmark(5, 7);
    expect(prisma.bookmark.deleteMany).toHaveBeenCalledWith({ where: { userId: 5, projectId: 7 } });
  });

  it('lists newest first within the public scope, 10 per page', async () => {
    const prisma = fakePrisma();
    const result = await createBookmarkService({ prisma }).listMyBookmarks(5, 2);
    const args = prisma.bookmark.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 5, project: PUBLIC_PROJECT_WHERE });
    expect(prisma.bookmark.count).toHaveBeenCalledWith({ where: args.where });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { projectId: 'desc' }]);
    expect(args.skip).toBe(MY_BOOKMARKS_PAGE_SIZE);
    expect(args.take).toBe(MY_BOOKMARKS_PAGE_SIZE);
    expect(args.select.project.select.applications.where).toEqual({ freelancerId: 5 });
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, totalCount: 11, totalPages: 2 });
  });
});

describe('rankRecommendations', () => {
  it('ranks open public projects by category, shared stacks, recency and id, with bound values', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([]) };
    const today = date('2026-10-14');
    await rankRecommendations(db, { projectId: 7, category: 'WEB', techStackIds: [1, 2], today });
    const [strings, ...values] = db.$queryRaw.mock.calls[0];
    const sql = strings.join('?').replace(/\s+/g, ' ');
    expect(sql).toContain('p.deleted_at IS NULL');
    expect(sql).toContain("p.status IN ('SCHEDULED', 'RECRUITING')");
    expect(sql).toContain('p.recruit_end_date >= ?::date');
    expect(sql).toContain("(p.status = 'RECRUITING' OR p.recruit_start_date <= ?::date)");
    expect(sql).toContain('p.id <> ?');
    expect(sql).toContain(
      'ORDER BY "sameCategory" DESC, "sharedTechStackCount" DESC, p.created_at DESC, p.id DESC',
    );
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(values).toEqual(['WEB', [1, 2], 7, today, today, 'WEB', RECOMMENDATION_LIMIT]);
  });
});
