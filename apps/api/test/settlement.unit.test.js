import { describe, expect, it } from 'vitest';
import { toAvailableActions, toDisplayStatus } from '../src/modules/contracts/contract.service.js';
import { computeSettlementAmounts } from '../src/modules/settlements/settlement.js';
import { parseDeliveryBody } from '../src/modules/settlements/settlement.validation.js';

describe('computeSettlementAmounts (B-14, D-18)', () => {
  it.each([
    [1n, 0n, 1n],
    [9n, 0n, 9n],
    [10n, 1n, 9n],
    [15n, 1n, 14n],
    [999_999n, 99_999n, 900_000n],
    [3_000_000n, 300_000n, 2_700_000n],
  ])('amount=%s → fee=%s payout=%s and sum equals amount', (amount, fee, payout) => {
    const result = computeSettlementAmounts(amount);
    expect(result.feeAmount).toBe(fee);
    expect(result.payoutAmount).toBe(payout);
    expect(result.feeAmount + result.payoutAmount).toBe(amount);
    expect(result.feeRate).toBe(0.1);
  });
});

describe('parseDeliveryBody (ESC-01)', () => {
  it('accepts note and optional https url', () => {
    const ok = parseDeliveryBody({
      note: '  최종 산출물입니다.  ',
      url: 'https://example.com/deliverable',
    });
    expect(ok.fields).toEqual({});
    expect(ok.note).toBe('최종 산출물입니다.');
    expect(ok.url).toBe('https://example.com/deliverable');
  });

  it('rejects empty note and non-http url', () => {
    expect(parseDeliveryBody({ note: '' }).fields).toHaveProperty('note');
    expect(parseDeliveryBody({ note: 'ok', url: 'ftp://x' }).fields).toHaveProperty('url');
    expect(parseDeliveryBody({ note: 'ok', extra: 1 }).fields).toHaveProperty('extra');
  });
});

describe('delivery display and actions (D-124)', () => {
  const base = {
    clientId: 1,
    freelancerId: 2,
    clientSignedAt: new Date(),
    freelancerSignedAt: new Date(),
    deliveryRequestedAt: null,
  };

  it('shows IN_PROGRESS display when SIGNED has workStartedAt', () => {
    expect(toDisplayStatus({ status: 'SIGNED', workStartedAt: null })).toBe('PAYMENT_PENDING');
    expect(toDisplayStatus({ status: 'SIGNED', workStartedAt: new Date() })).toBe('IN_PROGRESS');
  });

  it('offers REQUEST_DELIVERY to freelancer on paid in-progress work', () => {
    const contract = {
      ...base,
      status: 'SIGNED',
      workStartedAt: new Date(),
    };
    expect(
      toAvailableActions(contract, 2, {
        projectStatus: 'IN_PROGRESS',
        hasPaidPayment: true,
        escrowStatus: 'HELD',
      }),
    ).toEqual(['REQUEST_DELIVERY']);
    expect(
      toAvailableActions(contract, 1, {
        projectStatus: 'IN_PROGRESS',
        hasPaidPayment: true,
        escrowStatus: 'HELD',
      }),
    ).toEqual([]);
  });

  it('offers APPROVE to client after delivery requested', () => {
    const contract = {
      ...base,
      status: 'DELIVERY_REQUESTED',
      workStartedAt: new Date(),
      deliveryRequestedAt: new Date(),
    };
    expect(
      toAvailableActions(contract, 1, {
        projectStatus: 'IN_PROGRESS',
        hasPaidPayment: true,
        escrowStatus: 'HELD',
      }),
    ).toEqual(['APPROVE']);
    expect(
      toAvailableActions(contract, 2, {
        projectStatus: 'IN_PROGRESS',
        hasPaidPayment: true,
        escrowStatus: 'HELD',
      }),
    ).toEqual([]);
  });

  it('offers WRITE_REVIEW after completed release when not yet reviewed', () => {
    const contract = {
      ...base,
      status: 'COMPLETED',
      workStartedAt: new Date(),
      deliveryRequestedAt: new Date(),
    };
    expect(
      toAvailableActions(contract, 1, {
        projectStatus: 'COMPLETED',
        hasPaidPayment: true,
        escrowStatus: 'RELEASED',
        hasWrittenReview: false,
      }),
    ).toEqual(['WRITE_REVIEW']);
    expect(
      toAvailableActions(contract, 2, {
        projectStatus: 'COMPLETED',
        hasPaidPayment: true,
        escrowStatus: 'RELEASED',
        hasWrittenReview: true,
      }),
    ).toEqual([]);
  });
});
