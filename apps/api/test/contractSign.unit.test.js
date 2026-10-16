import { describe, expect, it } from 'vitest';
import {
  toAvailableActions,
  toContractDto,
  toDisplayStatus,
} from '../src/modules/contracts/contract.service.js';
import {
  parseContractListQuery,
  parseSignBody,
} from '../src/modules/contracts/contract.validation.js';
import { HttpError } from '../src/utils/httpError.js';

const base = {
  id: 1,
  projectId: 10,
  applicationId: 20,
  clientId: 100,
  freelancerId: 200,
  projectTitle: '테스트',
  agreedAmount: 1_000_000n,
  durationDays: 14,
  terms: '계약 본문',
  partiesSnapshot: { client: { name: '의뢰' }, freelancer: { name: '프리' } },
  status: 'SIGNATURE_PENDING',
  clientSignedAt: null,
  freelancerSignedAt: null,
  signedAt: null,
  cancelledAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

describe('parseSignBody', () => {
  it('agreed true만 통과하고 서명 시각·사용자 필드를 거부한다', () => {
    expect(parseSignBody({ agreed: true })).toEqual({ fields: {}, agreed: true });
    expect(parseSignBody({}).agreed).toBe(false);
    expect(parseSignBody({ agreed: false }).fields.agreed).toBeTruthy();
    expect(parseSignBody({ agreed: true, signedAt: 'x' }).agreed).toBe(false);
    expect(parseSignBody({ agreed: true, userId: 1 }).fields.userId).toBeTruthy();
  });
});

describe('parseContractListQuery', () => {
  it('page·status를 검사한다', () => {
    expect(parseContractListQuery({})).toEqual({ page: 1, status: null });
    expect(parseContractListQuery({ page: '2', status: 'SIGNED' })).toEqual({
      page: 2,
      status: 'SIGNED',
    });
    expect(() => parseContractListQuery({ page: '0' })).toThrow(HttpError);
    expect(() => parseContractListQuery({ status: 'NOPE' })).toThrow(HttpError);
  });
});

describe('contract display helpers', () => {
  it('한쪽만 서명하면 대기 displayStatus를 쓴다', () => {
    expect(toDisplayStatus(base)).toBe('SIGNATURE_PENDING');
    expect(toDisplayStatus({ ...base, clientSignedAt: new Date() })).toBe(
      'WAITING_FREELANCER_SIGNATURE',
    );
    expect(toDisplayStatus({ ...base, freelancerSignedAt: new Date() })).toBe(
      'WAITING_CLIENT_SIGNATURE',
    );
    expect(toDisplayStatus({ ...base, status: 'SIGNED', signedAt: new Date() })).toBe(
      'PAYMENT_PENDING',
    );
  });

  it('SIGN 액션은 미서명 당사자에게만 준다', () => {
    expect(toAvailableActions(base, 100)).toEqual(['SIGN']);
    expect(toAvailableActions(base, 200)).toEqual(['SIGN']);
    expect(toAvailableActions({ ...base, clientSignedAt: new Date() }, 100)).toEqual([]);
    expect(toAvailableActions(base, 100, { projectStatus: 'CANCELLED' })).toEqual([]);
    expect(toAvailableActions({ ...base, status: 'SIGNED' }, 100)).toEqual([]);
  });

  it('DTO는 금액 문자열과 체결 여부를 맞춘다', () => {
    const dto = toContractDto(base, 100);
    expect(dto.agreedAmount).toBe('1000000');
    expect(dto.isFullySigned).toBe(false);
    expect(dto.viewerRole).toBe('CLIENT');
    expect(dto.availableActions).toEqual(['SIGN']);
    expect(
      toContractDto({ ...base, signedAt: new Date(), status: 'SIGNED' }, 100).isFullySigned,
    ).toBe(true);
  });
});
