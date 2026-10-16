// 지원 입력 검증·모집 상태 판단(KST)·응답 변환 단위 테스트(DB 없음).
import { describe, expect, it } from 'vitest';
import {
  assertDecisionOpen,
  assertPending,
  assertRecruiting,
  toApplication,
  toOwnerApplication,
} from '../src/modules/applications/application.service.js';
import {
  COVER_LETTER_MAX_LENGTH,
  DURATION_DAYS_MAX,
  parseApplicationId,
  parseApplicationInput,
  parseApplicationListQuery,
  parseDecisionBody,
} from '../src/modules/applications/application.validation.js';
import { toProjectDetail } from '../src/modules/projects/project.service.js';
import { toDbDate, todayKst } from '../src/modules/projects/projectStatus.js';

const errorOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return { status: error.status, code: error.code, details: error.details };
  }
  throw new Error('expected an error');
};

const valid = {
  coverLetter: '  안녕하세요  ',
  proposedAmount: '2500000',
  proposedDurationDays: 30,
};

describe('parseApplicationInput', () => {
  it('trims the cover letter and keeps the amount as BigInt', () => {
    const { fields, input } = parseApplicationInput({
      ...valid,
      proposedAmount: '9007199254740993123',
    });
    expect(fields).toEqual({});
    expect(input).toEqual({
      coverLetter: '안녕하세요',
      proposedAmount: 9007199254740993123n,
      proposedDurationDays: 30,
    });
    expect(parseApplicationInput({ ...valid, proposedAmount: 1500 }).input.proposedAmount).toBe(
      1500n,
    );
  });

  it('requires all three RFP fields (A-29)', () => {
    for (const body of [{}, null, [], 'text']) {
      expect(Object.keys(parseApplicationInput(body).fields).sort()).toEqual([
        'coverLetter',
        'proposedAmount',
        'proposedDurationDays',
      ]);
    }
  });

  it('rejects out-of-range values', () => {
    const fieldsOf = (overrides) => parseApplicationInput({ ...valid, ...overrides }).fields;
    expect(fieldsOf({ coverLetter: '   ' })).toHaveProperty('coverLetter');
    expect(fieldsOf({ coverLetter: 'a'.repeat(COVER_LETTER_MAX_LENGTH) })).toEqual({});
    expect(fieldsOf({ coverLetter: 'a'.repeat(COVER_LETTER_MAX_LENGTH + 1) })).toHaveProperty(
      'coverLetter',
    );
    for (const amount of ['0', '-1', '1.5', '1e6', 'abc', 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(fieldsOf({ proposedAmount: amount })).toHaveProperty('proposedAmount');
    }
    expect(fieldsOf({ proposedAmount: '9223372036854775808' })).toHaveProperty('proposedAmount');
    expect(fieldsOf({ proposedAmount: '9223372036854775807' })).toEqual({});
    for (const days of [0, -1, 1.5, '30', DURATION_DAYS_MAX + 1, null]) {
      expect(fieldsOf({ proposedDurationDays: days })).toHaveProperty('proposedDurationDays');
    }
    expect(fieldsOf({ proposedDurationDays: DURATION_DAYS_MAX })).toEqual({});
  });

  it('refuses values only the server may set', () => {
    const { fields } = parseApplicationInput({
      ...valid,
      freelancerId: 1,
      projectId: 2,
      status: 'ACCEPTED',
      rejectReason: 'MANUAL',
      decidedAt: '2026-10-14',
    });
    expect(Object.keys(fields).sort()).toEqual([
      'decidedAt',
      'freelancerId',
      'projectId',
      'rejectReason',
      'status',
    ]);
  });
});

describe('path and query parsing', () => {
  it('treats malformed application ids as not found', () => {
    expect(parseApplicationId('12')).toBe(12);
    for (const bad of ['0', 'abc', '1e3', '-1', '1234567890', '']) {
      expect(errorOf(() => parseApplicationId(bad)).status).toBe(404);
    }
  });

  it('accepts page and the three statuses only', () => {
    expect(parseApplicationListQuery({})).toEqual({ page: 1, status: null });
    expect(parseApplicationListQuery({ page: '2', status: 'REJECTED' })).toEqual({
      page: 2,
      status: 'REJECTED',
    });
    for (const status of ['WITHDRAWN', 'pending', ['PENDING', 'ACCEPTED']]) {
      expect(errorOf(() => parseApplicationListQuery({ status })).status).toBe(400);
    }
    expect(errorOf(() => parseApplicationListQuery({ page: '0' })).status).toBe(400);
  });

  it('takes no body for accept and reject and refuses an offer amount for now', () => {
    expect(parseDecisionBody(undefined)).toEqual({});
    expect(parseDecisionBody({})).toEqual({});
    expect(parseDecisionBody({ offerAmount: '2800000' })).toEqual({
      offerAmount: '합의 금액은 선정 후 POST /applications/:id/offer 로 별도 제안해 주세요.',
    });
    expect(Object.keys(parseDecisionBody({ status: 'ACCEPTED', reason: 'x' })).sort()).toEqual([
      'reason',
      'status',
    ]);
    expect(parseDecisionBody([])).toHaveProperty('body');
  });
});

describe('decision rules (D-34 RFP, D-95)', () => {
  const project = (overrides = {}) => ({
    status: 'RECRUITING',
    recruitStartDate: null,
    recruitEndDate: toDbDate('2026-10-20'),
    deletedAt: null,
    ...overrides,
  });

  it('allows selecting only while actually recruiting, through 23:59 KST of the deadline', () => {
    const lastMoment = todayKst(new Date('2026-10-20T14:59:59.999Z'));
    const nextDay = todayKst(new Date('2026-10-20T15:00:00.000Z'));
    expect(() => assertDecisionOpen(project(), lastMoment, '선정')).not.toThrow();
    expect(errorOf(() => assertDecisionOpen(project(), nextDay, '선정'))).toMatchObject({
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
      details: { projectStatus: 'CLOSED' },
    });
    const scheduledButStarted = project({
      status: 'SCHEDULED',
      recruitStartDate: toDbDate('2026-10-15'),
    });
    expect(() => assertDecisionOpen(scheduledButStarted, '2026-10-15', '거절')).not.toThrow();
  });

  it('refuses closed, contract-stage and cancelled projects with their own status', () => {
    for (const status of ['CLOSED', 'CONTRACTING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
      expect(errorOf(() => assertDecisionOpen(project({ status }), '2026-10-14', '선정'))).toEqual(
        expect.objectContaining({ status: 409, details: { projectStatus: status } }),
      );
    }
  });

  it('only decides pending applications', () => {
    expect(() => assertPending({ status: 'PENDING' }, '선정')).not.toThrow();
    expect(errorOf(() => assertPending({ status: 'ACCEPTED' }, '거절'))).toMatchObject({
      status: 409,
      details: { applicationStatus: 'ACCEPTED' },
    });
    expect(errorOf(() => assertPending({ status: 'REJECTED' }, '선정'))).toMatchObject({
      status: 409,
      details: { applicationStatus: 'REJECTED' },
    });
  });
});

describe('assertRecruiting (D-34, D-83)', () => {
  const project = (overrides = {}) => ({
    status: 'RECRUITING',
    recruitStartDate: null,
    recruitEndDate: toDbDate('2026-10-20'),
    deletedAt: null,
    ...overrides,
  });

  it('allows applying through the deadline day and refuses from 00:00 KST the next day', () => {
    const lastMoment = todayKst(new Date('2026-10-20T14:59:59.999Z'));
    const nextDay = todayKst(new Date('2026-10-20T15:00:00.000Z'));
    expect(lastMoment).toBe('2026-10-20');
    expect(() => assertRecruiting(project(), lastMoment)).not.toThrow();
    expect(errorOf(() => assertRecruiting(project(), nextDay))).toMatchObject({
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
      details: { currentStatus: 'CLOSED' },
    });
  });

  it('treats a scheduled project as recruiting once its start date arrives', () => {
    const scheduled = project({ status: 'SCHEDULED', recruitStartDate: toDbDate('2026-10-15') });
    expect(errorOf(() => assertRecruiting(scheduled, '2026-10-14')).details).toEqual({
      currentStatus: 'SCHEDULED',
    });
    expect(() => assertRecruiting(scheduled, '2026-10-15')).not.toThrow();
  });

  it('refuses every non-recruiting stored status and hides cancelled or deleted projects', () => {
    for (const status of ['CLOSED', 'CONTRACTING', 'IN_PROGRESS', 'COMPLETED']) {
      expect(errorOf(() => assertRecruiting(project({ status }), '2026-10-14'))).toMatchObject({
        status: 409,
        details: { currentStatus: 'CLOSED' },
      });
    }
    expect(
      errorOf(() => assertRecruiting(project({ status: 'CANCELLED' }), '2026-10-14')).status,
    ).toBe(404);
    expect(
      errorOf(() => assertRecruiting(project({ deletedAt: new Date() }), '2026-10-14')).status,
    ).toBe(404);
    expect(errorOf(() => assertRecruiting(null, '2026-10-14')).status).toBe(404);
  });
});

describe('response shapes', () => {
  const projectRow = {
    id: 3,
    title: '쇼핑몰',
    category: 'WEB',
    budget: 9007199254740993123n,
    recruitStartDate: null,
    recruitEndDate: toDbDate('2026-10-20'),
    status: 'RECRUITING',
    deletedAt: null,
  };
  const application = {
    id: 7,
    projectId: 3,
    freelancerId: 11,
    coverLetter: '소개',
    proposedAmount: 2500000n,
    proposedDurationDays: 30,
    status: 'PENDING',
    rejectReason: null,
    decidedAt: null,
    createdAt: new Date('2026-10-14T00:00:00Z'),
    updatedAt: new Date('2026-10-14T00:00:00Z'),
    project: projectRow,
  };

  it('serializes amounts as strings and the project with its current public status', () => {
    const open = toApplication(application, '2026-10-20');
    expect(open).toMatchObject({
      proposedAmount: '2500000',
      project: { budget: '9007199254740993123', publicStatus: 'RECRUITING', isDeleted: false },
    });
    expect(open).not.toHaveProperty('freelancerId');
    expect(toApplication(application, '2026-10-21').project.publicStatus).toBe('CLOSED');
    const deleted = toApplication(
      { ...application, project: { ...projectRow, deletedAt: new Date() } },
      '2026-10-14',
    );
    expect(deleted.project).toMatchObject({ isDeleted: true, publicStatus: 'CLOSED' });
  });

  it('adds the public profile and the allowed actions for the project owner', () => {
    const withFreelancer = {
      ...application,
      freelancer: {
        id: 11,
        name: '박프리',
        role: 'FREELANCER',
        profileImageUrl: null,
        bio: null,
        clientProfile: null,
        freelancerProfile: {
          mainCategory: 'WEB',
          careerYears: 3,
          hourlyRate: 50000n,
          portfolioUrl: null,
          techStacks: [],
        },
      },
    };
    const owner = toOwnerApplication(withFreelancer, '2026-10-20');
    expect(owner.availableActions).toEqual(['ACCEPT', 'REJECT']);
    expect(owner.freelancer).toMatchObject({ id: 11, name: '박프리', role: 'FREELANCER' });
    expect(
      JSON.stringify(owner, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    ).not.toMatch(/hourlyRate|email/);
    expect(toOwnerApplication(withFreelancer, '2026-10-21').availableActions).toEqual([]);
    expect(
      toOwnerApplication({ ...withFreelancer, status: 'REJECTED' }, '2026-10-20').availableActions,
    ).toEqual([]);
    expect(
      toOwnerApplication(
        { ...withFreelancer, project: { ...projectRow, status: 'CONTRACTING' } },
        '2026-10-20',
      ).availableActions,
    ).toEqual([]);
  });

  it('adds myApplication and applicant locks to the project detail only when given', () => {
    const row = {
      ...projectRow,
      clientId: 10,
      description: 'd',
      createdAt: new Date('2026-10-14T00:00:00Z'),
      updatedAt: new Date('2026-10-14T00:00:00Z'),
      client: { id: 10, name: '의뢰인', profileImageUrl: null, clientProfile: null },
      techStacks: [],
      _count: { applications: 4 },
    };
    expect(toProjectDetail(row, null)).not.toHaveProperty('myApplication');
    expect(toProjectDetail(row, null).applicantCount).toBe(4);
    expect(toProjectDetail(row, 11, { myApplication: null }).myApplication).toBeNull();
    expect(toProjectDetail(row, 11, { myApplication: application }).myApplication).toEqual({
      id: 7,
      status: 'PENDING',
      rejectReason: null,
      createdAt: application.createdAt,
    });
    expect(toProjectDetail(row, 10).lockedFields).toEqual([]);
    expect(toProjectDetail(row, 10, { activeApplicantCount: 2 }).lockedFields).toEqual([
      'budget',
      'recruitEndDate',
    ]);
    expect(
      toProjectDetail({ ...row, status: 'CLOSED' }, 10, { activeApplicantCount: 1 }).lockedFields,
    ).toEqual(['recruitStartDate', 'recruitEndDate', 'budget']);
  });
});
