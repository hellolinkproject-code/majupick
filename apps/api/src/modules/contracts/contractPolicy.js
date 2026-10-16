/**
 * 프로젝트 취소와 계약 모듈 연결(D-110, STAT-02).
 * SIGNED 이후(체결)는 취소를 막고, SIGNATURE_PENDING·미서명 계약은 같은 TX에서 CANCELLED로 정리한다.
 */

/** SIGNED 이후 단계. 체결 완료로 보아 프로젝트 취소를 막는다(D-13). */
const BLOCKING_STATUSES = new Set(['SIGNED', 'IN_PROGRESS', 'DELIVERY_REQUESTED', 'COMPLETED']);

export const prismaContractPolicy = Object.freeze({
  /**
   * @param {object} tx
   * @param {{ id: number }} project
   */
  async findBlockingContract(tx, project) {
    return tx.contract.findFirst({
      where: { projectId: project.id, status: { in: [...BLOCKING_STATUSES] } },
      select: { id: true, status: true },
    });
  },

  /**
   * @param {object} tx
   * @param {{ id: number }} project
   * @param {{ now: Date }} opts
   */
  async cancelOpenContracts(tx, project, { now }) {
    const result = await tx.contract.updateMany({
      where: { projectId: project.id, status: 'SIGNATURE_PENDING' },
      data: { status: 'CANCELLED', cancelledAt: now },
    });
    return result.count;
  },
});
