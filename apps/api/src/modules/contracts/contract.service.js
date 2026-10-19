import { HttpError } from '../../utils/httpError.js';
import { pagination } from '../projects/project.service.js';
import { fromDbDate, todayKst } from '../projects/projectStatus.js';
import {
  CONTRACT_LIST_PAGE_SIZE,
  parseOfferAmountBody,
  parseSignBody,
} from './contract.validation.js';
import { buildContractTerms, buildPartiesSnapshot } from './contractTerms.js';

const notFoundApp = () => new HttpError(404, 'NOT_FOUND', '지원 내역을 찾을 수 없습니다.');
const notFoundContract = () => new HttpError(404, 'NOT_FOUND', '계약서를 찾을 수 없습니다.');
const invalid = (message, details) =>
  new HttpError(409, 'INVALID_STATE_TRANSITION', message, details);
const alreadySigned = () => new HttpError(409, 'ALREADY_SIGNED', '이미 전자서명한 계약입니다.');

/**
 * 화면·목록용 표시 상태.
 * SIGNED는 기본적으로 결제 대기(D-13). 결제 후 work_started_at이 있으면 작업 중(D-122·D-124).
 */
export function toDisplayStatus(contract) {
  switch (contract.status) {
    case 'CANCELLED':
      return 'CANCELLED';
    case 'SIGNED':
      return contract.workStartedAt ? 'IN_PROGRESS' : 'PAYMENT_PENDING';
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'DELIVERY_REQUESTED':
      return 'DELIVERY_REQUESTED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'SIGNATURE_PENDING':
      if (contract.clientSignedAt && !contract.freelancerSignedAt) {
        return 'WAITING_FREELANCER_SIGNATURE';
      }
      if (!contract.clientSignedAt && contract.freelancerSignedAt) {
        return 'WAITING_CLIENT_SIGNATURE';
      }
      return 'SIGNATURE_PENDING';
    default:
      return contract.status;
  }
}

/**
 * @param {object} contract
 * @param {number} viewerId
 * @param {{
 *   projectStatus?: string,
 *   projectDeletedAt?: Date | null,
 *   hasPaidPayment?: boolean,
 *   escrowStatus?: string | null,
 * }} [context]
 */
export function toAvailableActions(contract, viewerId, context = {}) {
  if (context.projectStatus === 'CANCELLED' || context.projectDeletedAt) return [];
  const isClient = contract.clientId === viewerId;
  const isFreelancer = contract.freelancerId === viewerId;
  if (contract.status === 'SIGNATURE_PENDING') {
    if (isClient && !contract.clientSignedAt) return ['SIGN'];
    if (isFreelancer && !contract.freelancerSignedAt) return ['SIGN'];
    return [];
  }
  // SIGNED + 프로젝트 CONTRACTING + 미결제 → 의뢰인만 결제(STEP 10-A)
  if (
    contract.status === 'SIGNED' &&
    isClient &&
    context.projectStatus === 'CONTRACTING' &&
    !context.hasPaidPayment
  ) {
    return ['PAY'];
  }
  // 작업 중(SIGNED|IN_PROGRESS + workStartedAt + 프로젝트 IN_PROGRESS + HELD) → 프리랜서 납품(D-124)
  if (
    isFreelancer &&
    (contract.status === 'SIGNED' || contract.status === 'IN_PROGRESS') &&
    contract.workStartedAt &&
    context.projectStatus === 'IN_PROGRESS' &&
    context.hasPaidPayment &&
    context.escrowStatus === 'HELD' &&
    !contract.deliveryRequestedAt
  ) {
    return ['REQUEST_DELIVERY'];
  }
  // 납품 요청됨 → 의뢰인 완료 승인
  if (
    contract.status === 'DELIVERY_REQUESTED' &&
    isClient &&
    context.projectStatus === 'IN_PROGRESS'
  ) {
    return ['APPROVE'];
  }
  return [];
}

/** API 응답용 계약 DTO. 금액은 문자열(D-51). 서명 시각·사용자 ID는 서버만 기록한다. */
export function toContractDto(contract, viewerId = null, context = {}) {
  const snapshot = contract.partiesSnapshot ?? {};
  const isParty =
    viewerId != null && (contract.clientId === viewerId || contract.freelancerId === viewerId);
  const viewerRole =
    viewerId == null
      ? null
      : contract.clientId === viewerId
        ? 'CLIENT'
        : contract.freelancerId === viewerId
          ? 'FREELANCER'
          : null;
  return {
    id: contract.id,
    projectId: contract.projectId,
    applicationId: contract.applicationId,
    clientId: contract.clientId,
    freelancerId: contract.freelancerId,
    projectTitle: contract.projectTitle,
    agreedAmount: contract.agreedAmount.toString(),
    durationDays: contract.durationDays,
    terms: contract.terms,
    partiesSnapshot: snapshot,
    status: contract.status,
    displayStatus: toDisplayStatus(contract),
    clientSignedAt: contract.clientSignedAt,
    freelancerSignedAt: contract.freelancerSignedAt,
    signedAt: contract.signedAt,
    workStartedAt: contract.workStartedAt ?? null,
    delivery: {
      note: contract.deliveryNote ?? null,
      url: contract.deliveryUrl ?? null,
      requestedAt: contract.deliveryRequestedAt ?? null,
    },
    completedAt: contract.completedAt ?? null,
    isFullySigned: contract.signedAt != null && contract.status !== 'CANCELLED',
    cancelledAt: contract.cancelledAt,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
    ...(isParty && {
      viewerRole,
      availableActions: toAvailableActions(contract, viewerId, context),
    }),
  };
}

/** CTR-03 목록 요약. 본문(terms)은 넣지 않는다. */
export function toContractSummary(contract, viewerId) {
  const dto = toContractDto(contract, viewerId);
  const { terms: _terms, partiesSnapshot, ...rest } = dto;
  return {
    ...rest,
    clientName: partiesSnapshot?.client?.name ?? null,
    freelancerName: partiesSnapshot?.freelancer?.name ?? null,
  };
}

function assertSignableSnapshot(contract) {
  if (contract.agreedAmount == null || contract.agreedAmount <= 0n) {
    throw invalid('합의 금액이 유효하지 않아 전자서명할 수 없습니다.');
  }
  if (!contract.terms || typeof contract.terms !== 'string' || !contract.terms.trim()) {
    throw invalid('계약서 본문이 없어 전자서명할 수 없습니다.');
  }
  if (!contract.partiesSnapshot || typeof contract.partiesSnapshot !== 'object') {
    throw invalid('계약서 스냅샷이 없어 전자서명할 수 없습니다.');
  }
  if (!contract.durationDays || contract.durationDays <= 0) {
    throw invalid('계약 기간이 유효하지 않아 전자서명할 수 없습니다.');
  }
}

/**
 * OFFER-01 / CTR-01 / CTR-02 / CTR-03 / CTR-04 / CTR-05.
 * 선정(DEC-01)과 금액 제안은 분리한다(D-118). 동의와 계약 생성은 한 트랜잭션(B-06).
 */
export function createContractService({ prisma, clock = () => new Date() }) {
  async function lockProjectByApplication(tx, applicationId) {
    const target = await tx.application.findUnique({
      where: { id: applicationId },
      select: { projectId: true },
    });
    if (!target) throw notFoundApp();
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${target.projectId} FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: target.projectId } });
    if (!project || project.deletedAt) throw notFoundApp();
    return project;
  }

  /** 프로젝트 → 계약 순으로 잠가 취소·서명 동시성을 맞춘다. */
  async function lockProjectAndContract(tx, contractId) {
    const head = await tx.contract.findUnique({
      where: { id: contractId },
      select: { id: true, projectId: true },
    });
    if (!head) throw notFoundContract();
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${head.projectId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: head.projectId } });
    if (!project || project.deletedAt) throw notFoundContract();
    const contract = await tx.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw notFoundContract();
    return { project, contract };
  }

  /**
   * OFFER-01 의뢰인 합의 금액 제안(단일 제안). CONTRACTING + ACCEPTED + 제안 없음 + 체결 계약 없음.
   */
  async function proposeOffer(clientId, applicationId, body) {
    const { fields, offerAmount } = parseOfferAmountBody(body);
    return prisma.$transaction(async (tx) => {
      const project = await lockProjectByApplication(tx, applicationId);
      if (project.clientId !== clientId) throw notFoundApp();
      if (project.status === 'CANCELLED') {
        throw invalid('취소된 프로젝트에는 합의 금액을 제안할 수 없습니다.', {
          projectStatus: project.status,
        });
      }
      if (project.status !== 'CONTRACTING') {
        throw invalid('계약 대기 상태에서만 합의 금액을 제안할 수 있습니다.', {
          projectStatus: project.status,
        });
      }

      const existingContract = await tx.contract.findUnique({
        where: { projectId: project.id },
        select: { id: true, status: true },
      });
      if (existingContract && existingContract.status !== 'CANCELLED') {
        throw invalid('이미 계약서가 있어 합의 금액을 다시 제안할 수 없습니다.', {
          contractId: existingContract.id,
          contractStatus: existingContract.status,
        });
      }

      const application = await tx.application.findFirst({
        where: { id: applicationId, projectId: project.id },
      });
      if (!application) throw notFoundApp();
      if (application.status !== 'ACCEPTED') {
        throw invalid('선정된 지원에만 합의 금액을 제안할 수 있습니다.', {
          applicationStatus: application.status,
        });
      }
      if (application.offerStatus != null) {
        throw invalid('이미 합의 금액을 제안했습니다. 금액을 다시 바꿀 수 없습니다.', {
          offerStatus: application.offerStatus,
        });
      }
      if (Object.keys(fields).length > 0 || offerAmount === null) {
        throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', { fields });
      }

      const offeredAt = clock();
      const changed = await tx.application.updateMany({
        where: {
          id: application.id,
          status: 'ACCEPTED',
          offerStatus: null,
        },
        data: {
          offerAmount,
          offerStatus: 'PENDING',
          offeredAt,
        },
      });
      if (changed.count !== 1) {
        throw invalid('이미 합의 금액을 제안했거나 지원 상태가 바뀌었습니다.');
      }

      const updated = await tx.application.findUnique({ where: { id: application.id } });
      return {
        id: updated.id,
        projectId: updated.projectId,
        proposedAmount: updated.proposedAmount.toString(),
        offerAmount: updated.offerAmount.toString(),
        offerStatus: updated.offerStatus,
        offeredAt: updated.offeredAt,
        status: updated.status,
      };
    });
  }

  /**
   * CTR-01 프리랜서 동의 → 합의 확정 + 계약서 생성(한 TX). 재시도·중복 생성은 updateMany+UNIQUE로 막는다.
   */
  async function agreeOffer(freelancerId, applicationId) {
    try {
      return await prisma.$transaction(async (tx) => {
        const project = await lockProjectByApplication(tx, applicationId);
        if (project.status === 'CANCELLED') {
          throw invalid('취소된 프로젝트의 금액 제안에 동의할 수 없습니다.', {
            projectStatus: project.status,
          });
        }
        if (project.status !== 'CONTRACTING') {
          throw invalid('계약 대기 상태에서만 금액 제안에 동의할 수 있습니다.', {
            projectStatus: project.status,
          });
        }

        const application = await tx.application.findFirst({
          where: { id: applicationId, projectId: project.id },
        });
        if (!application || application.freelancerId !== freelancerId) throw notFoundApp();
        if (application.status !== 'ACCEPTED' || application.offerStatus !== 'PENDING') {
          throw invalid('대기 중인 합의 금액 제안이 없습니다.', {
            applicationStatus: application.status,
            offerStatus: application.offerStatus,
          });
        }

        const respondedAt = clock();
        const changed = await tx.application.updateMany({
          where: {
            id: application.id,
            status: 'ACCEPTED',
            offerStatus: 'PENDING',
          },
          data: {
            offerStatus: 'AGREED',
            offerRespondedAt: respondedAt,
          },
        });
        if (changed.count !== 1) {
          throw invalid('이미 처리된 금액 제안입니다.');
        }

        const [client, freelancer] = await Promise.all([
          tx.user.findUnique({
            where: { id: project.clientId },
            select: {
              id: true,
              name: true,
              email: true,
              clientProfile: { select: { companyName: true } },
            },
          }),
          tx.user.findUnique({
            where: { id: application.freelancerId },
            select: { id: true, name: true, email: true },
          }),
        ]);
        if (!client || !freelancer) throw notFoundApp();

        const agreedAmount = application.offerAmount;
        const durationDays = application.proposedDurationDays;
        const projectTitle = project.title;
        const clientParty = {
          id: client.id,
          name: client.name,
          email: client.email,
          companyName: client.clientProfile?.companyName ?? null,
        };
        const terms = buildContractTerms({
          projectTitle,
          agreedAmount,
          durationDays,
          client: clientParty,
          freelancer,
        });
        const partiesSnapshot = buildPartiesSnapshot({
          projectTitle,
          agreedAmount,
          durationDays,
          recruitStartDate: fromDbDate(project.recruitStartDate),
          recruitEndDate: fromDbDate(project.recruitEndDate),
          client: clientParty,
          freelancer,
        });

        const contract = await tx.contract.create({
          data: {
            projectId: project.id,
            applicationId: application.id,
            clientId: project.clientId,
            freelancerId: application.freelancerId,
            projectTitle,
            agreedAmount,
            durationDays,
            terms,
            partiesSnapshot,
            status: 'SIGNATURE_PENDING',
          },
        });

        // 프로젝트는 CONTRACTING 유지. 결제·서명 전에는 IN_PROGRESS로 올리지 않는다.
        return toContractDto(contract, freelancerId, {
          projectStatus: project.status,
          projectDeletedAt: project.deletedAt,
        });
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        throw invalid('이미 계약서가 생성되어 있습니다.');
      }
      throw error;
    }
  }

  /**
   * CTR-02 프리랜서 거부. 지원 REJECTED(NEGOTIATION_FAILED) + D-10 프로젝트 복귀/마감.
   * 마감일 당일까지는 RECRUITING(closed_at 해제), 다음 날부터는 CLOSED.
   */
  async function declineOffer(freelancerId, applicationId) {
    return prisma.$transaction(async (tx) => {
      const project = await lockProjectByApplication(tx, applicationId);
      if (project.status === 'CANCELLED') {
        throw invalid('취소된 프로젝트의 금액 제안을 거부할 수 없습니다.', {
          projectStatus: project.status,
        });
      }
      if (project.status !== 'CONTRACTING') {
        throw invalid('계약 대기 상태에서만 금액 제안을 거부할 수 있습니다.', {
          projectStatus: project.status,
        });
      }

      const application = await tx.application.findFirst({
        where: { id: applicationId, projectId: project.id },
      });
      if (!application || application.freelancerId !== freelancerId) throw notFoundApp();
      if (application.status !== 'ACCEPTED' || application.offerStatus !== 'PENDING') {
        throw invalid('대기 중인 합의 금액 제안이 없습니다.', {
          applicationStatus: application.status,
          offerStatus: application.offerStatus,
        });
      }

      const respondedAt = clock();
      const changed = await tx.application.updateMany({
        where: {
          id: application.id,
          status: 'ACCEPTED',
          offerStatus: 'PENDING',
        },
        data: {
          offerStatus: 'DECLINED',
          offerRespondedAt: respondedAt,
          status: 'REJECTED',
          rejectReason: 'NEGOTIATION_FAILED',
          decidedAt: respondedAt,
        },
      });
      if (changed.count !== 1) {
        throw invalid('이미 처리된 금액 제안입니다.');
      }

      const today = todayKst(clock());
      const endDay = fromDbDate(project.recruitEndDate);
      const stillInRecruitWindow = endDay >= today;
      if (stillInRecruitWindow) {
        await tx.project.update({
          where: { id: project.id },
          data: { status: 'RECRUITING', closedAt: null },
        });
      } else {
        await tx.project.update({
          where: { id: project.id },
          data: { status: 'CLOSED', closedAt: project.closedAt ?? respondedAt },
        });
      }

      const updated = await tx.application.findUnique({ where: { id: application.id } });
      return {
        id: updated.id,
        projectId: updated.projectId,
        status: updated.status,
        rejectReason: updated.rejectReason,
        proposedAmount: updated.proposedAmount.toString(),
        offerAmount: updated.offerAmount?.toString() ?? null,
        offerStatus: updated.offerStatus,
        offeredAt: updated.offeredAt,
        offerRespondedAt: updated.offerRespondedAt,
        decidedAt: updated.decidedAt,
        projectStatusAfter: stillInRecruitWindow ? 'RECRUITING' : 'CLOSED',
        reopenedRecruiting: stillInRecruitWindow,
      };
    });
  }

  /** CTR-04 계약서 조회. 당사자만. */
  async function getContractForViewer(userId, contractId) {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: { project: { select: { status: true, deletedAt: true } } },
    });
    if (!contract) throw notFoundContract();
    if (contract.clientId !== userId && contract.freelancerId !== userId) {
      throw notFoundContract();
    }
    const paid = await prisma.payment.findFirst({
      where: { contractId: contract.id, status: 'PAID' },
      select: {
        id: true,
        status: true,
        escrowStatus: true,
        paidAt: true,
        amount: true,
        feeAmount: true,
        payoutAmount: true,
        releasedAt: true,
      },
    });
    const dto = toContractDto(contract, userId, {
      projectStatus: contract.project.status,
      projectDeletedAt: contract.project.deletedAt,
      hasPaidPayment: Boolean(paid),
      escrowStatus: paid?.escrowStatus ?? null,
    });
    return {
      ...dto,
      projectStatus: contract.project.status,
      payment: paid
        ? {
            id: paid.id,
            status: paid.status,
            escrowStatus: paid.escrowStatus,
            paidAt: paid.paidAt,
            amount: paid.amount.toString(),
            feeAmount: paid.feeAmount != null ? paid.feeAmount.toString() : null,
            payoutAmount: paid.payoutAmount != null ? paid.payoutAmount.toString() : null,
            releasedAt: paid.releasedAt,
            escrowNote:
              paid.escrowStatus === 'RELEASED'
                ? '모의 지급 처리됨 (실제 송금 없음)'
                : '테스트 결제 완료 / 에스크로 보관 시뮬레이션',
          }
        : null,
    };
  }

  /** CTR-03 내 계약 목록. 의뢰인·프리랜서 모두 자기 당사자 계약만. */
  async function listMyContracts(userId, { page, status }) {
    const where = {
      OR: [{ clientId: userId }, { freelancerId: userId }],
      ...(status ? { status } : {}),
    };
    const [totalCount, contracts] = await prisma.$transaction(
      [
        prisma.contract.count({ where }),
        prisma.contract.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * CONTRACT_LIST_PAGE_SIZE,
          take: CONTRACT_LIST_PAGE_SIZE,
        }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: contracts.map((contract) => toContractSummary(contract, userId)),
      pagination: pagination(page, CONTRACT_LIST_PAGE_SIZE, totalCount),
    };
  }

  /**
   * CTR-05 체크박스 전자서명. 서명 시각·사용자 ID는 서버 시계·토큰만 사용한다.
   * 양측 서명 시 SIGNED + signed_at. 프로젝트는 CONTRACTING 유지(결제 전 IN_PROGRESS 금지).
   */
  async function signContract(userId, contractId, body) {
    const { fields, agreed } = parseSignBody(body);
    if (!agreed) {
      throw new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', { fields });
    }

    return prisma.$transaction(async (tx) => {
      const { project, contract } = await lockProjectAndContract(tx, contractId);

      if (contract.clientId !== userId && contract.freelancerId !== userId) {
        throw notFoundContract();
      }

      if (project.status === 'CANCELLED' || project.deletedAt) {
        throw invalid('취소되거나 삭제된 프로젝트의 계약에는 서명할 수 없습니다.', {
          projectStatus: project.status,
        });
      }

      if (contract.status === 'CANCELLED') {
        throw invalid('취소된 계약에는 서명할 수 없습니다.', {
          contractStatus: contract.status,
        });
      }

      if (contract.status !== 'SIGNATURE_PENDING') {
        if (
          (contract.clientId === userId && contract.clientSignedAt) ||
          (contract.freelancerId === userId && contract.freelancerSignedAt)
        ) {
          throw alreadySigned();
        }
        throw invalid('전자서명할 수 있는 계약 상태가 아닙니다.', {
          contractStatus: contract.status,
        });
      }

      const isClient = contract.clientId === userId;
      if (isClient && contract.clientSignedAt) throw alreadySigned();
      if (!isClient && contract.freelancerSignedAt) throw alreadySigned();

      assertSignableSnapshot(contract);

      const signedAt = clock();
      const partyWhere = isClient ? { clientSignedAt: null } : { freelancerSignedAt: null };
      const partyData = isClient ? { clientSignedAt: signedAt } : { freelancerSignedAt: signedAt };

      const changed = await tx.contract.updateMany({
        where: {
          id: contract.id,
          status: 'SIGNATURE_PENDING',
          ...partyWhere,
        },
        data: partyData,
      });
      if (changed.count !== 1) {
        const again = await tx.contract.findUnique({ where: { id: contract.id } });
        if (
          again &&
          ((isClient && again.clientSignedAt) || (!isClient && again.freelancerSignedAt))
        ) {
          throw alreadySigned();
        }
        throw invalid('계약 상태가 바뀌어 전자서명할 수 없습니다.');
      }

      // 양측이 거의 동시에 서명해도, 두 시각이 모두 채워진 뒤에만 체결로 올린다.
      await tx.contract.updateMany({
        where: {
          id: contract.id,
          status: 'SIGNATURE_PENDING',
          clientSignedAt: { not: null },
          freelancerSignedAt: { not: null },
        },
        data: {
          status: 'SIGNED',
          signedAt,
        },
      });

      const saved = await tx.contract.findUnique({ where: { id: contract.id } });
      // 프로젝트는 CONTRACTING 유지. SIGNED ≠ 결제 완료 ≠ IN_PROGRESS.
      return toContractDto(saved, userId, {
        projectStatus: project.status,
        projectDeletedAt: project.deletedAt,
      });
    });
  }

  return {
    proposeOffer,
    agreeOffer,
    declineOffer,
    getContractForViewer,
    listMyContracts,
    signContract,
  };
}
