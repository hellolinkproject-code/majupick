/**
 * 모의 에스크로 정산 금액 계산(D-18, D-51, ERD §5 #7).
 * fee = amount / 10n (BigInt 나눗셈 = floor), payout = amount - fee.
 * Number로 변환하지 않는다. 실제 이체는 하지 않는다.
 *
 * @param {bigint} amount
 * @returns {{ feeAmount: bigint, payoutAmount: bigint, feeRate: number }}
 */
export function computeSettlementAmounts(amount) {
  if (typeof amount !== 'bigint' || amount <= 0n) {
    throw new TypeError('settlement amount must be a positive bigint');
  }
  const feeAmount = amount / 10n;
  const payoutAmount = amount - feeAmount;
  return { feeAmount, payoutAmount, feeRate: 0.1 };
}

/** 정산 API 응답용. 금액은 문자열. */
export function toSettlementDto({
  amount,
  feeAmount,
  payoutAmount,
  escrowStatus,
  paidAt = null,
  releasedAt = null,
  feeRate = 0.1,
}) {
  return {
    amount: amount.toString(),
    feeRate,
    feeAmount: feeAmount.toString(),
    payoutAmount: payoutAmount.toString(),
    escrowStatus,
    paidAt,
    releasedAt,
  };
}
