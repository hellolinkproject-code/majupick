import { HttpError } from '../../utils/httpError.js';
import { toContractDto } from '../contracts/contract.service.js';
import { parseDeliveryBody } from './settlement.validation.js';
import { computeSettlementAmounts, toSettlementDto } from './settlement.js';

const notFoundContract = () => new HttpError(404, 'NOT_FOUND', '계약서를 찾을 수 없습니다.');
const invalid = (message, details) =>
  new HttpError(409, 'INVALID_STATE_TRANSITION', message, details);

/**
 * ESC-01~03. 납품 요청 · 완료 승인(모의 에스크로 RELEASED) · 정산 조회.
 * 실제 송금·PG 지급은 하지 않는다(D-123).
 *
 * D-124: 결제 후 계약은 SIGNED 유지(D-122). 작업 중 판단은
 * work_started_at + 프로젝트 IN_PROGRESS + 결제 PAID/HELD 로 한다.
 * 납품 요청 시 SIGNED(또는 IN_PROGRESS) → DELIVERY_REQUESTED.
 */
export function createSettlementService({ prisma, clock = () => new Date() }) {
  async function lockProjectContractPayment(tx, contractId) {
    const head = await tx.contract.findUnique({
      where: { id: contractId },
      select: { id: true, projectId: true },
    });
    if (!head) throw notFoundContract();
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${head.projectId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: head.projectId } });
    const contract = await tx.contract.findUnique({ where: { id: contractId } });
    if (!project || project.deletedAt || !contract) throw notFoundContract();
    const payment = await tx.payment.findFirst({
      where: { contractId: contract.id, status: 'PAID' },
    });
    if (payment) {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`;
    }
    return {
      project,
      contract,
      payment: payment ? await tx.payment.findUnique({ where: { id: payment.id } }) : null,
    };
  }

  function assertParty(contract, userId) {
    if (contract.clientId !== userId && contract.freelancerId !== userId) {
      throw notFoundContract();
    }
  }

  function isWorkInProgress(contract, project, payment) {
    return (
      (contract.status === 'SIGNED' || contract.status === 'IN_PROGRESS') &&
      contract.workStartedAt != null &&
      project.status === 'IN_PROGRESS' &&
      payment?.status === 'PAID' &&
      payment?.escrowStatus === 'HELD' &&
      contract.deliveryRequestedAt == null
    );
  }

  /** ESC-01 프리랜서 납품 요청(1회). */
  async function requestDelivery(userId, role, contractId, body) {
    if (role !== 'FREELANCER') {
      throw new HttpError(403, 'FORBIDDEN', '프리랜서만 납품을 요청할 수 있습니다.');
    }
    const { fields, note, url } = parseDeliveryBody(body);
    if (Object.keys(fields).length > 0 || note == null) {
      throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', { fields });
    }

    return prisma.$transaction(async (tx) => {
      const { project, contract, payment } = await lockProjectContractPayment(tx, contractId);
      if (contract.freelancerId !== userId) throw notFoundContract();

      if (project.status === 'CANCELLED' || project.deletedAt) {
        throw invalid('취소되거나 삭제된 프로젝트에는 납품을 요청할 수 없습니다.', {
          projectStatus: project.status,
        });
      }

      if (contract.status === 'DELIVERY_REQUESTED' || contract.deliveryRequestedAt) {
        throw invalid('이미 납품을 요청한 계약입니다.', {
          contractStatus: contract.status,
        });
      }
      if (contract.status === 'COMPLETED') {
        throw invalid('이미 완료된 계약입니다.', { contractStatus: contract.status });
      }
      if (contract.status === 'CANCELLED') {
        throw invalid('취소된 계약에는 납품을 요청할 수 없습니다.', {
          contractStatus: contract.status,
        });
      }

      if (!isWorkInProgress(contract, project, payment)) {
        throw invalid('작업 중인 계약에서만 납품을 요청할 수 있습니다.', {
          contractStatus: contract.status,
          projectStatus: project.status,
          escrowStatus: payment?.escrowStatus ?? null,
        });
      }

      const requestedAt = clock();
      const changed = await tx.contract.updateMany({
        where: {
          id: contract.id,
          status: { in: ['SIGNED', 'IN_PROGRESS'] },
          deliveryRequestedAt: null,
          workStartedAt: { not: null },
        },
        data: {
          status: 'DELIVERY_REQUESTED',
          deliveryNote: note,
          deliveryUrl: url,
          deliveryRequestedAt: requestedAt,
        },
      });
      if (changed.count !== 1) {
        throw invalid('계약 상태가 바뀌어 납품을 요청할 수 없습니다.');
      }

      const saved = await tx.contract.findUnique({ where: { id: contract.id } });
      const dto = toContractDto(saved, userId, {
        projectStatus: project.status,
        projectDeletedAt: project.deletedAt,
        hasPaidPayment: true,
        escrowStatus: payment.escrowStatus,
      });
      return {
        ...dto,
        projectStatus: project.status,
        payment: {
          id: payment.id,
          status: payment.status,
          escrowStatus: payment.escrowStatus,
          paidAt: payment.paidAt,
          amount: payment.amount.toString(),
          feeAmount: null,
          payoutAmount: null,
          releasedAt: null,
          escrowNote: '테스트 결제 완료 / 에스크로 보관 시뮬레이션',
        },
      };
    });
  }

  /**
   * ESC-02 의뢰인 완료 승인 + 모의 에스크로 RELEASED + 프로젝트 COMPLETED.
   * 한 트랜잭션. 실제 이체 없음.
   */
  async function approveDelivery(userId, role, contractId) {
    if (role !== 'CLIENT') {
      throw new HttpError(403, 'FORBIDDEN', '의뢰인만 완료를 승인할 수 있습니다.');
    }

    return prisma.$transaction(async (tx) => {
      const { project, contract, payment } = await lockProjectContractPayment(tx, contractId);
      if (contract.clientId !== userId) throw notFoundContract();

      if (project.status === 'CANCELLED' || project.deletedAt) {
        throw invalid('취소되거나 삭제된 프로젝트는 승인할 수 없습니다.', {
          projectStatus: project.status,
        });
      }

      if (contract.status === 'COMPLETED') {
        throw invalid('이미 완료 승인된 계약입니다.', { contractStatus: contract.status });
      }
      if (contract.status !== 'DELIVERY_REQUESTED') {
        throw invalid('납품 요청 후에만 완료를 승인할 수 있습니다.', {
          contractStatus: contract.status,
        });
      }
      if (project.status !== 'IN_PROGRESS') {
        throw invalid('작업 중인 프로젝트만 완료할 수 있습니다.', {
          projectStatus: project.status,
        });
      }
      if (!payment || payment.status !== 'PAID' || payment.escrowStatus !== 'HELD') {
        throw invalid('에스크로 보관(HELD) 상태의 결제가 있어야 정산할 수 있습니다.', {
          escrowStatus: payment?.escrowStatus ?? null,
          paymentStatus: payment?.status ?? null,
        });
      }

      const { feeAmount, payoutAmount } = computeSettlementAmounts(payment.amount);
      const releasedAt = clock();

      const paymentChanged = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: 'PAID',
          escrowStatus: 'HELD',
          feeAmount: null,
          payoutAmount: null,
          releasedAt: null,
        },
        data: {
          escrowStatus: 'RELEASED',
          feeAmount,
          payoutAmount,
          releasedAt,
        },
      });
      if (paymentChanged.count !== 1) {
        throw invalid('이미 정산 처리된 결제입니다.');
      }

      const contractChanged = await tx.contract.updateMany({
        where: {
          id: contract.id,
          status: 'DELIVERY_REQUESTED',
        },
        data: {
          status: 'COMPLETED',
          completedAt: releasedAt,
        },
      });
      if (contractChanged.count !== 1) {
        throw invalid('계약 상태가 바뀌어 완료 승인할 수 없습니다.');
      }

      const projectChanged = await tx.project.updateMany({
        where: {
          id: project.id,
          status: 'IN_PROGRESS',
        },
        data: {
          status: 'COMPLETED',
        },
      });
      if (projectChanged.count !== 1) {
        throw invalid('프로젝트 상태가 바뀌어 완료할 수 없습니다.');
      }

      const savedContract = await tx.contract.findUnique({ where: { id: contract.id } });
      const savedPayment = await tx.payment.findUnique({ where: { id: payment.id } });
      const settlement = toSettlementDto({
        amount: savedPayment.amount,
        feeAmount: savedPayment.feeAmount,
        payoutAmount: savedPayment.payoutAmount,
        escrowStatus: savedPayment.escrowStatus,
        paidAt: savedPayment.paidAt,
        releasedAt: savedPayment.releasedAt,
      });
      const contractDto = {
        ...toContractDto(savedContract, userId, {
          projectStatus: 'COMPLETED',
          projectDeletedAt: project.deletedAt,
          hasPaidPayment: true,
          escrowStatus: 'RELEASED',
        }),
        projectStatus: 'COMPLETED',
        payment: {
          id: savedPayment.id,
          status: savedPayment.status,
          escrowStatus: savedPayment.escrowStatus,
          paidAt: savedPayment.paidAt,
          amount: savedPayment.amount.toString(),
          feeAmount: savedPayment.feeAmount.toString(),
          payoutAmount: savedPayment.payoutAmount.toString(),
          releasedAt: savedPayment.releasedAt,
          escrowNote: '모의 지급 처리됨 (실제 송금 없음)',
        },
      };

      return { contract: contractDto, settlement };
    });
  }

  /** ESC-03 정산 정보. 당사자만. 지급 전이면 예상 수수료·지급액. */
  async function getSettlement(userId, contractId) {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        clientId: true,
        freelancerId: true,
      },
    });
    if (!contract) throw notFoundContract();
    assertParty(contract, userId);

    const payment = await prisma.payment.findFirst({
      where: { contractId: contract.id, status: 'PAID' },
    });
    if (!payment) {
      throw new HttpError(404, 'NOT_FOUND', '결제 내역을 찾을 수 없습니다.');
    }

    if (payment.escrowStatus === 'RELEASED' && payment.feeAmount != null) {
      return toSettlementDto({
        amount: payment.amount,
        feeAmount: payment.feeAmount,
        payoutAmount: payment.payoutAmount,
        escrowStatus: payment.escrowStatus,
        paidAt: payment.paidAt,
        releasedAt: payment.releasedAt,
      });
    }

    const { feeAmount, payoutAmount, feeRate } = computeSettlementAmounts(payment.amount);
    return toSettlementDto({
      amount: payment.amount,
      feeAmount,
      payoutAmount,
      escrowStatus: payment.escrowStatus ?? 'HELD',
      paidAt: payment.paidAt,
      releasedAt: null,
      feeRate,
    });
  }

  return {
    requestDelivery,
    approveDelivery,
    getSettlement,
    computeSettlementAmounts,
  };
}
