import { HttpError } from '../../utils/httpError.js';
import { CANCELLABLE_STATUSES } from './projectStatus.js';

/**
 * 프로젝트 취소(STAT-02, A-27). RFP 2.3: 계약 체결 이전에만 취소할 수 있고, 체결 후에는 정상 완료나 환불 흐름을 거친다.
 * 체결 = 양측 서명 완료(D-13 확정 부분).
 *
 * 계약 판단은 contractPolicy로 분리했다. 계약·전자서명 테이블이 아직 없어서 지금은 서명이나 결제가 일어날 수 없으므로
 * 기본 정책(NO_CONTRACT_MODULE)은 막는 계약도, 함께 취소할 계약도 없다고 답한다. 계약 단계를 구현하면 이 정책을
 * 실제 계약 조회로 바꾼다: findBlockingContract는 SIGNED 이후 계약을 돌려주고, cancelOpenContracts는
 * 서명 전 계약을 같은 트랜잭션에서 CANCELLED로 바꾼다(API_SPEC_v1 STAT-02).
 */
export const NO_CONTRACT_MODULE = Object.freeze({
  async findBlockingContract() {
    return null;
  },
  async cancelOpenContracts() {
    return 0;
  },
});

const SIGNED_STAGE_MESSAGE =
  '계약이 체결된 프로젝트는 취소할 수 없습니다. 정상 완료 또는 환불 절차를 거쳐야 합니다.';

/** 소유자에게 보내는 오류라 내부 상태를 알려 준다. */
function notCancellable(status, contract = null) {
  const message = status === 'CANCELLED' ? '이미 취소된 프로젝트입니다.' : SIGNED_STAGE_MESSAGE;
  return new HttpError(409, 'INVALID_STATE_TRANSITION', message, {
    currentStatus: status,
    ...(contract && { contractStatus: contract.status }),
  });
}

/**
 * 잠근 프로젝트를 취소한다. 호출자는 프로젝트 행을 FOR UPDATE로 잠그고 날짜 동기화를 마친 값을 넘긴다.
 * 한 트랜잭션 안에서 ① 취소 가능 상태·계약 확인 ② PENDING 지원 → REJECTED(PROJECT_CANCELLED) + decided_at
 * ③ 서명 전 계약 정리(contractPolicy) ④ 프로젝트 CANCELLED + cancelled_at.
 * 이미 거절된 지원은 사유·처리 시각을 그대로 두고, 선정(ACCEPTED)된 지원도 선정 이력으로 남긴다.
 * 취소 전용 알림은 RFP 필수 5종에 없어 만들지 않는다(마감 알림 ⑤로 대신 보내지 않는다).
 */
export async function cancelLockedProject(
  tx,
  project,
  { now, contractPolicy = NO_CONTRACT_MODULE },
) {
  if (!CANCELLABLE_STATUSES.has(project.status)) throw notCancellable(project.status);
  const contract = await contractPolicy.findBlockingContract(tx, project);
  if (contract) throw notCancellable(project.status, contract);

  const rejected = await tx.application.updateMany({
    where: { projectId: project.id, status: 'PENDING' },
    data: { status: 'REJECTED', rejectReason: 'PROJECT_CANCELLED', decidedAt: now },
  });
  const keptAcceptedCount = await tx.application.count({
    where: { projectId: project.id, status: 'ACCEPTED' },
  });
  await contractPolicy.cancelOpenContracts(tx, project, { now });
  await tx.project.update({
    where: { id: project.id },
    data: { status: 'CANCELLED', cancelledAt: now },
  });
  return { rejectedCount: rejected.count, keptAcceptedCount };
}
