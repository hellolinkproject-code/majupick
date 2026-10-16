import { randomBytes } from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { pagination } from '../projects/project.service.js';
import {
  PAYMENT_LIST_PAGE_SIZE,
  parseConfirmBody,
  parseFailBody,
  toTossAmount,
} from './payment.validation.js';

const notFoundPayment = () => new HttpError(404, 'NOT_FOUND', '결제 내역을 찾을 수 없습니다.');
const notFoundContract = () => new HttpError(404, 'NOT_FOUND', '계약서를 찾을 수 없습니다.');
const invalid = (message, details) =>
  new HttpError(409, 'INVALID_STATE_TRANSITION', message, details);

function newOrderId() {
  return `wb_${Date.now().toString(36)}_${randomBytes(8).toString('hex')}`;
}

/** API Payment DTO. 금액 문자열(D-51). 카드번호·시크릿 없음. */
export function toPaymentDto(payment, extras = {}) {
  return {
    id: payment.id,
    contractId: payment.contractId,
    projectId: extras.projectId ?? payment.contract?.projectId ?? null,
    projectTitle: extras.projectTitle ?? payment.contract?.projectTitle ?? null,
    payerId: payment.payerId,
    orderId: payment.orderId,
    amount: payment.amount.toString(),
    currency: 'KRW',
    status: payment.status,
    method: payment.method,
    paidAt: payment.paidAt,
    failCode: payment.failCode,
    failReason: payment.failReason,
    escrowStatus: payment.escrowStatus,
    /** 모의 에스크로 안내. 실제 금융 보관이 아니다. */
    escrowNote:
      payment.escrowStatus === 'HELD'
        ? '테스트 결제 완료 / 에스크로 보관 시뮬레이션'
        : payment.escrowStatus === 'RELEASED'
          ? '모의 지급 처리됨'
          : null,
    feeAmount: payment.feeAmount != null ? payment.feeAmount.toString() : null,
    payoutAmount: payment.payoutAmount != null ? payment.payoutAmount.toString() : null,
    releasedAt: payment.releasedAt,
    provider: 'TOSS',
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

/**
 * PAY-01~05. 승인 HTTP는 TX 밖에서, DB 반영은 짧은 TX로(D-123).
 */
export function createPaymentService({ prisma, pgClient, pgConfig, clock = () => new Date() }) {
  async function lockProjectAndContract(tx, contractId) {
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
    return { project, contract };
  }

  /** PAY-01 결제 준비. READY가 있으면 재사용. */
  async function preparePayment(userId, role, contractId) {
    if (role !== 'CLIENT') {
      throw new HttpError(403, 'FORBIDDEN', '의뢰인만 결제할 수 있습니다.');
    }

    return prisma.$transaction(async (tx) => {
      const { project, contract } = await lockProjectAndContract(tx, contractId);
      if (contract.clientId !== userId) throw notFoundContract();
      if (project.clientId !== userId) throw notFoundContract();
      if (project.status === 'CANCELLED') {
        throw invalid('취소된 프로젝트는 결제할 수 없습니다.', {
          projectStatus: project.status,
        });
      }
      if (project.status !== 'CONTRACTING') {
        throw invalid('계약 대기 상태의 프로젝트만 결제할 수 있습니다.', {
          projectStatus: project.status,
        });
      }
      if (contract.status !== 'SIGNED') {
        throw invalid('양측 서명이 완료된 계약만 결제할 수 있습니다.', {
          contractStatus: contract.status,
        });
      }

      const paid = await tx.payment.findFirst({
        where: { contractId: contract.id, status: 'PAID' },
        select: { id: true },
      });
      if (paid) {
        throw invalid('이미 결제가 완료된 계약입니다.', { paymentId: paid.id });
      }

      toTossAmount(contract.agreedAmount);

      let payment = await tx.payment.findFirst({
        where: { contractId: contract.id, status: 'READY' },
        orderBy: { id: 'desc' },
      });
      if (!payment) {
        try {
          payment = await tx.payment.create({
            data: {
              contractId: contract.id,
              payerId: userId,
              orderId: newOrderId(),
              amount: contract.agreedAmount,
              status: 'READY',
            },
          });
        } catch (error) {
          // 동시 준비 요청이 겹치면 다시 조회한다.
          payment = await tx.payment.findFirst({
            where: { contractId: contract.id, status: 'READY' },
            orderBy: { id: 'desc' },
          });
          if (!payment) throw error;
        }
      }

      const payer = await tx.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });

      return {
        paymentId: payment.id,
        orderId: payment.orderId,
        orderName: contract.projectTitle.slice(0, 100),
        amount: payment.amount.toString(),
        currency: 'KRW',
        customerName: payer?.name ?? '의뢰인',
        contractId: contract.id,
        projectId: project.id,
        pg: {
          mode: pgConfig.mode,
          usesBrowserSdk: pgConfig.usesBrowserSdk,
          clientKey: pgConfig.usesBrowserSdk ? pgConfig.clientKey : null,
        },
        /** mock/Fake 안내. 실제 토스 창이 아님을 숨기지 않는다 */
        testNotice: pgConfig.usesBrowserSdk
          ? '토스페이먼츠 테스트 결제창으로 이동합니다. 실결제가 아닙니다.'
          : 'Fake PG 테스트 결제입니다. 토스페이먼츠 실연동 키가 없어 모의 승인으로 검증합니다.',
      };
    });
  }

  /**
   * READY → PAID + 프로젝트 IN_PROGRESS.
   * 계약 상태는 SIGNED 유지(STEP 10-A / D-123). API_SPEC의 계약 IN_PROGRESS와 다름.
   */
  async function applyPaidInTx(tx, { payment, project, contract, pgResult, now }) {
    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'READY' },
      data: {
        status: 'PAID',
        paymentKey: pgResult.paymentKey,
        method: pgResult.method ?? '카드',
        paidAt: now,
        escrowStatus: 'HELD',
        failCode: null,
        failReason: null,
      },
    });
    if (changed.count !== 1) {
      const again = await tx.payment.findUnique({ where: { id: payment.id } });
      if (again?.status === 'PAID' && again.paymentKey === pgResult.paymentKey) {
        return again;
      }
      throw invalid('결제 상태가 바뀌어 승인 결과를 반영할 수 없습니다.');
    }

    const projectChanged = await tx.project.updateMany({
      where: { id: project.id, status: 'CONTRACTING' },
      data: { status: 'IN_PROGRESS' },
    });
    if (projectChanged.count !== 1) {
      throw invalid('프로젝트 상태를 작업 중으로 바꿀 수 없습니다.', {
        projectStatus: project.status,
      });
    }

    // 계약은 SIGNED 유지. work_started_at만 기록해 결제 후 작업 시작 시각을 남긴다.
    if (!contract.workStartedAt) {
      await tx.contract.update({
        where: { id: contract.id },
        data: { workStartedAt: now },
      });
    }

    return tx.payment.findUnique({
      where: { id: payment.id },
      include: { contract: { select: { projectId: true, projectTitle: true } } },
    });
  }

  function assertPgDoneMatches(pgResult, { orderId, amountNumber, paymentKey }) {
    if (pgResult.status !== 'DONE') {
      throw new HttpError(502, 'PG_ERROR', 'PG가 결제를 완료(DONE)로 승인하지 않았습니다.', {
        pgStatus: pgResult.status,
      });
    }
    if (pgResult.orderId !== orderId) {
      throw new HttpError(502, 'PG_ERROR', 'PG 주문 번호가 일치하지 않습니다.');
    }
    if (pgResult.paymentKey !== paymentKey) {
      throw new HttpError(502, 'PG_ERROR', 'PG 결제 키가 일치하지 않습니다.');
    }
    if (pgResult.currency && pgResult.currency !== 'KRW') {
      throw new HttpError(502, 'PG_ERROR', '통화가 KRW가 아닙니다.');
    }
    if (pgResult.totalAmount !== amountNumber) {
      throw new HttpError(400, 'PAYMENT_AMOUNT_MISMATCH', '결제 금액이 일치하지 않습니다.', {
        expected: String(amountNumber),
        actual: String(pgResult.totalAmount),
      });
    }
  }

  /** PAY-02 승인 검증. PG HTTP는 TX 밖. */
  async function confirmPayment(userId, role, body) {
    if (role !== 'CLIENT') {
      throw new HttpError(403, 'FORBIDDEN', '의뢰인만 결제를 승인할 수 있습니다.');
    }
    const { fields, paymentKey, orderId, amountBigInt } = parseConfirmBody(body);
    if (Object.keys(fields).length > 0 || amountBigInt === null) {
      throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', { fields });
    }

    const payment = await prisma.payment.findUnique({
      where: { orderId },
      include: {
        contract: { select: { id: true, projectId: true, projectTitle: true, clientId: true } },
      },
    });
    if (!payment || payment.payerId !== userId) throw notFoundPayment();

    if (payment.status === 'PAID') {
      if (payment.paymentKey === paymentKey) {
        return {
          payment: toPaymentDto(payment, {
            projectId: payment.contract.projectId,
            projectTitle: payment.contract.projectTitle,
          }),
          contractId: payment.contractId,
          recovered: false,
          idempotent: true,
        };
      }
      throw invalid('이미 다른 결제 키로 승인된 주문입니다.');
    }

    if (payment.status !== 'READY') {
      throw invalid('승인할 수 있는 결제 상태가 아닙니다.', { paymentStatus: payment.status });
    }

    if (payment.amount !== amountBigInt) {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: 'READY' },
        data: {
          status: 'FAILED',
          failCode: 'PAYMENT_AMOUNT_MISMATCH',
          failReason: '요청 금액이 주문 금액과 다릅니다.',
        },
      });
      throw new HttpError(400, 'PAYMENT_AMOUNT_MISMATCH', '결제 금액이 일치하지 않습니다.', {
        expected: payment.amount.toString(),
        actual: amountBigInt.toString(),
      });
    }

    const amountNumber = toTossAmount(payment.amount);
    let pgResult;
    try {
      pgResult = await pgClient.confirm({
        paymentKey,
        orderId,
        amount: amountNumber,
      });
    } catch (error) {
      if (error instanceof HttpError && error.code === 'PG_ERROR') {
        await prisma.payment.updateMany({
          where: { id: payment.id, status: 'READY' },
          data: {
            status: 'FAILED',
            failCode: error.pgCode ?? 'PG_ERROR',
            failReason: error.message.slice(0, 500),
          },
        });
      }
      throw error;
    }

    try {
      assertPgDoneMatches(pgResult, { orderId, amountNumber, paymentKey });
    } catch (error) {
      if (error instanceof HttpError && error.code === 'PAYMENT_AMOUNT_MISMATCH') {
        await prisma.payment.updateMany({
          where: { id: payment.id, status: 'READY' },
          data: {
            status: 'FAILED',
            failCode: 'PAYMENT_AMOUNT_MISMATCH',
            failReason: 'PG 승인 금액이 주문 금액과 다릅니다.',
          },
        });
      } else if (error instanceof HttpError && error.code === 'PG_ERROR') {
        await prisma.payment.updateMany({
          where: { id: payment.id, status: 'READY' },
          data: {
            status: 'FAILED',
            failCode: 'PG_STATUS',
            failReason: error.message.slice(0, 500),
          },
        });
      }
      throw error;
    }

    const now = clock();
    try {
      const saved = await prisma.$transaction(async (tx) => {
        const { project, contract } = await lockProjectAndContract(tx, payment.contractId);
        if (contract.clientId !== userId) throw notFoundPayment();
        if (project.status === 'CANCELLED' || project.deletedAt) {
          throw invalid('취소되거나 삭제된 프로젝트의 결제를 확정할 수 없습니다.');
        }
        const fresh = await tx.payment.findUnique({ where: { id: payment.id } });
        if (!fresh) throw notFoundPayment();
        if (fresh.status === 'PAID' && fresh.paymentKey === paymentKey) {
          return tx.payment.findUnique({
            where: { id: payment.id },
            include: { contract: { select: { projectId: true, projectTitle: true } } },
          });
        }
        return applyPaidInTx(tx, {
          payment: fresh,
          project,
          contract,
          pgResult,
          now,
        });
      });
      return {
        payment: toPaymentDto(saved),
        contractId: saved.contractId,
        recovered: false,
        idempotent: false,
      };
    } catch (error) {
      // PG는 DONE인데 DB 반영 실패 → 조회 API로 복구 시도
      try {
        const recovered = await recoverPaidFromPg(userId, paymentKey, orderId);
        if (recovered) {
          return { ...recovered, recovered: true, idempotent: false };
        }
      } catch {
        // 복구 실패면 원래 오류를 그대로
      }
      throw error;
    }
  }

  /**
   * PG 승인 성공 후 DB 실패 복구. paymentKey로 PG 조회 → DONE이면 PAID 반영.
   */
  async function recoverPaidFromPg(userId, paymentKey, orderId) {
    const payment = await prisma.payment.findUnique({
      where: { orderId },
      include: {
        contract: { select: { projectId: true, projectTitle: true, clientId: true } },
      },
    });
    if (!payment || payment.payerId !== userId) return null;
    if (payment.status === 'PAID') {
      return {
        payment: toPaymentDto(payment, {
          projectId: payment.contract.projectId,
          projectTitle: payment.contract.projectTitle,
        }),
        contractId: payment.contractId,
      };
    }
    if (payment.status !== 'READY' && payment.status !== 'FAILED') return null;

    const pgResult = await pgClient.retrieve(paymentKey);
    const amountNumber = toTossAmount(payment.amount);
    assertPgDoneMatches(pgResult, { orderId, amountNumber, paymentKey });

    // FAILED였다면 READY로 되돌린 뒤 PAID(복구 경로)
    if (payment.status === 'FAILED') {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: 'FAILED' },
        data: { status: 'READY', failCode: null, failReason: null },
      });
    }

    const now = clock();
    const saved = await prisma.$transaction(async (tx) => {
      const { project, contract } = await lockProjectAndContract(tx, payment.contractId);
      const fresh = await tx.payment.findUnique({ where: { id: payment.id } });
      if (fresh.status === 'PAID') {
        return tx.payment.findUnique({
          where: { id: payment.id },
          include: { contract: { select: { projectId: true, projectTitle: true } } },
        });
      }
      if (fresh.status !== 'READY') {
        throw invalid('복구할 수 있는 결제 상태가 아닙니다.');
      }
      return applyPaidInTx(tx, { payment: fresh, project, contract, pgResult, now });
    });
    return {
      payment: toPaymentDto(saved),
      contractId: saved.contractId,
    };
  }

  /** PAY-03 실패 기록. 계약·프로젝트 상태는 유지. */
  async function failPayment(userId, role, body) {
    if (role !== 'CLIENT') {
      throw new HttpError(403, 'FORBIDDEN', '의뢰인만 결제 실패를 기록할 수 있습니다.');
    }
    const { fields, orderId, code, message } = parseFailBody(body);
    if (Object.keys(fields).length > 0 || !orderId) {
      throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', { fields });
    }

    const payment = await prisma.payment.findUnique({
      where: { orderId },
      include: {
        contract: { select: { projectId: true, projectTitle: true } },
      },
    });
    if (!payment || payment.payerId !== userId) throw notFoundPayment();
    if (payment.status === 'PAID') {
      throw invalid('이미 승인된 결제는 실패로 바꿀 수 없습니다.');
    }
    if (payment.status === 'FAILED') {
      return toPaymentDto(payment);
    }

    const updated = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'READY' },
      data: { status: 'FAILED', failCode: code, failReason: message },
    });
    if (updated.count !== 1) {
      const again = await prisma.payment.findUnique({
        where: { id: payment.id },
        include: { contract: { select: { projectId: true, projectTitle: true } } },
      });
      return toPaymentDto(again);
    }
    const saved = await prisma.payment.findUnique({
      where: { id: payment.id },
      include: { contract: { select: { projectId: true, projectTitle: true } } },
    });
    return toPaymentDto(saved);
  }

  /** PAY-04 내 결제 내역. 의뢰인=본인 결제, 프리랜서=자기 계약 결제. */
  async function listMyPayments(userId, role, { page }) {
    const where =
      role === 'CLIENT'
        ? { payerId: userId }
        : { contract: { freelancerId: userId }, status: 'PAID' };

    const [totalCount, rows] = await prisma.$transaction(
      [
        prisma.payment.count({ where }),
        prisma.payment.findMany({
          where,
          include: { contract: { select: { projectId: true, projectTitle: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * PAYMENT_LIST_PAGE_SIZE,
          take: PAYMENT_LIST_PAGE_SIZE,
        }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: rows.map((row) => toPaymentDto(row)),
      pagination: pagination(page, PAYMENT_LIST_PAGE_SIZE, totalCount),
    };
  }

  /** PAY-05 단건. 결제자 또는 계약 프리랜서(PAID만 프리랜서에게). */
  async function getPaymentForViewer(userId, role, paymentId) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        contract: {
          select: {
            projectId: true,
            projectTitle: true,
            clientId: true,
            freelancerId: true,
          },
        },
      },
    });
    if (!payment) throw notFoundPayment();
    const isPayer = payment.payerId === userId;
    const isFreelancer =
      role === 'FREELANCER' &&
      payment.contract.freelancerId === userId &&
      payment.status === 'PAID';
    if (!isPayer && !isFreelancer) throw notFoundPayment();
    return toPaymentDto(payment);
  }

  /** 계약 상세용 최신 결제 요약 */
  async function findPaymentSummaryForContract(contractId) {
    const paid = await prisma.payment.findFirst({
      where: { contractId, status: 'PAID' },
      orderBy: { id: 'desc' },
    });
    if (paid) return toPaymentDto(paid);
    const ready = await prisma.payment.findFirst({
      where: { contractId, status: 'READY' },
      orderBy: { id: 'desc' },
    });
    return ready ? toPaymentDto(ready) : null;
  }

  return {
    preparePayment,
    confirmPayment,
    failPayment,
    listMyPayments,
    getPaymentForViewer,
    findPaymentSummaryForContract,
    recoverPaidFromPg,
  };
}
