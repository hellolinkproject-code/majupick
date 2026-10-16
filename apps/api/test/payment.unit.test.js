import { describe, expect, it } from 'vitest';
import {
  isTossLiveKey,
  isTossTestClientKey,
  isTossTestSecretKey,
  loadPgConfig,
  PgConfigError,
} from '../src/config/pg.js';
import { createFakePgClient } from '../src/modules/payments/pgClient.js';
import { parseConfirmBody, toTossAmount } from '../src/modules/payments/payment.validation.js';
import { toAvailableActions } from '../src/modules/contracts/contract.service.js';
import { HttpError } from '../src/utils/httpError.js';

describe('pg config (N-04)', () => {
  it('defaults to mock and rejects live keys', () => {
    expect(loadPgConfig({}).mode).toBe('mock');
    expect(isTossTestClientKey('test_ck_abc')).toBe(true);
    expect(isTossTestSecretKey('test_gsk_abc')).toBe(true);
    expect(isTossLiveKey('live_sk_abc')).toBe(true);
    expect(() =>
      loadPgConfig({
        PG_MODE: 'mock',
        TOSS_SECRET_KEY: 'live_sk_xxx',
      }),
    ).toThrow(PgConfigError);
  });

  it('requires test keys for toss mode', () => {
    expect(() => loadPgConfig({ PG_MODE: 'toss' })).toThrow(PgConfigError);
    const cfg = loadPgConfig({
      PG_MODE: 'toss',
      TOSS_CLIENT_KEY: 'test_ck_demo',
      TOSS_SECRET_KEY: 'test_sk_demo',
      TOSS_ENABLE_TEST_CALLS: 'false',
    });
    expect(cfg.usesLiveConfirm).toBe(false);
    expect(cfg.usesBrowserSdk).toBe(false);
  });
});

describe('payment validation', () => {
  it('converts bigint to safe Toss amount', () => {
    expect(toTossAmount(1000n)).toBe(1000);
    expect(() => toTossAmount(0n)).toThrow(HttpError);
  });

  it('parses confirm body and rejects unknown fields', () => {
    const ok = parseConfirmBody({
      paymentKey: 'pk',
      orderId: 'wb_1',
      amount: '3000000',
    });
    expect(ok.amountBigInt).toBe(3000000n);
    expect(
      parseConfirmBody({ paymentKey: 'pk', orderId: 'o', amount: 10, signedAt: 'x' }).fields,
    ).toHaveProperty('signedAt');
  });
});

describe('fake pg client', () => {
  it('returns DONE and is idempotent for the same paymentKey', async () => {
    const pg = createFakePgClient();
    const a = await pg.confirm({ paymentKey: 'k1', orderId: 'o1', amount: 100 });
    const b = await pg.confirm({ paymentKey: 'k1', orderId: 'o1', amount: 100 });
    expect(a.status).toBe('DONE');
    expect(b.paymentKey).toBe(a.paymentKey);
  });
});

describe('contract PAY action', () => {
  it('offers PAY only to client on SIGNED contracting unpaid contracts', () => {
    const contract = {
      status: 'SIGNED',
      clientId: 1,
      freelancerId: 2,
      clientSignedAt: new Date(),
      freelancerSignedAt: new Date(),
    };
    expect(
      toAvailableActions(contract, 1, {
        projectStatus: 'CONTRACTING',
        hasPaidPayment: false,
      }),
    ).toEqual(['PAY']);
    expect(
      toAvailableActions(contract, 1, {
        projectStatus: 'CONTRACTING',
        hasPaidPayment: true,
      }),
    ).toEqual([]);
    expect(
      toAvailableActions(contract, 2, {
        projectStatus: 'CONTRACTING',
        hasPaidPayment: false,
      }),
    ).toEqual([]);
  });
});
