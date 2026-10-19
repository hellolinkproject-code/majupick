import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { HttpError } from '../../utils/httpError.js';
import { parseApplicationId } from '../applications/application.validation.js';
import { createSettlementService } from '../settlements/settlement.service.js';
import { createContractService } from './contract.service.js';
import { parseContractId, parseContractListQuery } from './contract.validation.js';

function onlyRole(role, message) {
  return (req, _res, next) => {
    if (req.auth.role === role) next();
    else next(new HttpError(403, 'FORBIDDEN', message));
  };
}

function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * OFFER-01 POST /applications/:id/offer
 * CTR-01 POST /applications/:id/offer/agree
 * CTR-02 POST /applications/:id/offer/decline
 * CTR-03 GET /me/contracts
 * CTR-04 GET /contracts/:contractId
 * CTR-05 POST /contracts/:contractId/sign
 * ESC-01 POST /contracts/:contractId/delivery
 * ESC-02 POST /contracts/:contractId/approve
 * ESC-03 GET /contracts/:contractId/settlement
 */
export function createContractsRouter({ prisma, authConfig, contractService, settlementService }) {
  const router = Router();
  const service = contractService ?? createContractService({ prisma });
  const settlements = settlementService ?? createSettlementService({ prisma });
  const authenticate = createAuthenticate(authConfig);
  const requireRole = createRequireRole(prisma);

  router.post(
    '/applications/:applicationId/offer',
    noStore,
    authenticate,
    requireRole,
    onlyRole('CLIENT', '프로젝트를 등록한 의뢰인만 합의 금액을 제안할 수 있습니다.'),
    async (req, res) => {
      const applicationId = parseApplicationId(req.params.applicationId);
      const data = await service.proposeOffer(req.auth.userId, applicationId, req.body);
      res.status(200).json({ data });
    },
  );

  router.post(
    '/applications/:applicationId/offer/agree',
    noStore,
    authenticate,
    requireRole,
    onlyRole('FREELANCER', '선정된 프리랜서만 합의 금액에 동의할 수 있습니다.'),
    async (req, res) => {
      const applicationId = parseApplicationId(req.params.applicationId);
      const data = await service.agreeOffer(req.auth.userId, applicationId);
      res.status(201).json({ data });
    },
  );

  router.post(
    '/applications/:applicationId/offer/decline',
    noStore,
    authenticate,
    requireRole,
    onlyRole('FREELANCER', '선정된 프리랜서만 합의 금액을 거부할 수 있습니다.'),
    async (req, res) => {
      const applicationId = parseApplicationId(req.params.applicationId);
      const data = await service.declineOffer(req.auth.userId, applicationId);
      res.status(200).json({ data });
    },
  );

  router.get('/me/contracts', noStore, authenticate, requireRole, async (req, res) => {
    const query = parseContractListQuery(req.query);
    res.status(200).json(await service.listMyContracts(req.auth.userId, query));
  });

  router.get('/contracts/:contractId', noStore, authenticate, requireRole, async (req, res) => {
    const contractId = parseContractId(req.params.contractId);
    const data = await service.getContractForViewer(req.auth.userId, contractId);
    res.status(200).json({ data });
  });

  router.post(
    '/contracts/:contractId/sign',
    noStore,
    authenticate,
    requireRole,
    async (req, res) => {
      const contractId = parseContractId(req.params.contractId);
      const data = await service.signContract(req.auth.userId, contractId, req.body);
      res.status(200).json({ data });
    },
  );

  router.post(
    '/contracts/:contractId/delivery',
    noStore,
    authenticate,
    requireRole,
    onlyRole('FREELANCER', '프리랜서만 납품을 요청할 수 있습니다.'),
    async (req, res) => {
      const contractId = parseContractId(req.params.contractId);
      const data = await settlements.requestDelivery(
        req.auth.userId,
        req.auth.role,
        contractId,
        req.body,
      );
      res.status(200).json({ data });
    },
  );

  router.post(
    '/contracts/:contractId/approve',
    noStore,
    authenticate,
    requireRole,
    onlyRole('CLIENT', '의뢰인만 완료를 승인할 수 있습니다.'),
    async (req, res) => {
      const contractId = parseContractId(req.params.contractId);
      const data = await settlements.approveDelivery(req.auth.userId, req.auth.role, contractId);
      res.status(200).json({ data });
    },
  );

  router.get(
    '/contracts/:contractId/settlement',
    noStore,
    authenticate,
    requireRole,
    async (req, res) => {
      const contractId = parseContractId(req.params.contractId);
      const data = await settlements.getSettlement(req.auth.userId, contractId);
      res.status(200).json({ data });
    },
  );

  return router;
}
