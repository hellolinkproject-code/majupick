import { HttpError } from '../../utils/httpError.js';
import { fromDbDate, todayKst } from '../projects/projectStatus.js';
import { parseOfferAmountBody } from './contract.validation.js';
import { buildContractTerms, buildPartiesSnapshot } from './contractTerms.js';

const notFoundApp = () => new HttpError(404, 'NOT_FOUND', '지원 내역을 찾을 수 없습니다.');
const notFoundContract = () => new HttpError(404, 'NOT_FOUND', '계약서를 찾을 수 없습니다.');
const invalid = (message, details) =>
  new HttpError(409, 'INVALID_STATE_TRANSITION', message, details);

/** API 응답용 계약 DTO. 금액은 문자열(D-51). 서명 전에는 signedAt null·isFullySigned false. */
export function toContractDto(contract) {
  const snapshot = contract.partiesSnapshot ?? {};
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
    clientSignedAt: contract.clientSignedAt,
    freelancerSignedAt: contract.freelancerSignedAt,
    signedAt: contract.signedAt,
    isFullySigned: contract.signedAt != null && contract.status !== 'CANCELLED',
    cancelledAt: contract.cancelledAt,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
  };
}

/**
 * OFFER-01 / CTR-01 / CTR-02 / CTR-04.
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
        return toContractDto(contract);
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
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw notFoundContract();
    if (contract.clientId !== userId && contract.freelancerId !== userId) {
      throw notFoundContract();
    }
    return toContractDto(contract);
  }

  return { proposeOffer, agreeOffer, declineOffer, getContractForViewer };
}
