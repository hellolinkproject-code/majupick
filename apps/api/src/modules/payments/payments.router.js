import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { parseContractId } from '../contracts/contract.validation.js';
import { parsePaymentId, parsePaymentListQuery } from './payment.validation.js';

function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * PAY-01 POST /contracts/:contractId/payments
 * PAY-02 POST /payments/confirm
 * PAY-03 POST /payments/fail
 * PAY-04 GET /me/payments
 * PAY-05 GET /payments/:paymentId
 */
export function createPaymentsRouter({ prisma, authConfig, paymentService }) {
  const router = Router();
  const service = paymentService;
  const authenticate = createAuthenticate(authConfig);
  const requireRole = createRequireRole(prisma);

  router.post(
    '/contracts/:contractId/payments',
    noStore,
    authenticate,
    requireRole,
    async (req, res) => {
      const contractId = parseContractId(req.params.contractId);
      const data = await service.preparePayment(req.auth.userId, req.auth.role, contractId);
      res.status(201).json({ data });
    },
  );

  router.post('/payments/confirm', noStore, authenticate, requireRole, async (req, res) => {
    const data = await service.confirmPayment(req.auth.userId, req.auth.role, req.body);
    res.status(200).json({ data });
  });

  router.post('/payments/fail', noStore, authenticate, requireRole, async (req, res) => {
    const data = await service.failPayment(req.auth.userId, req.auth.role, req.body);
    res.status(200).json({ data });
  });

  router.get('/me/payments', noStore, authenticate, requireRole, async (req, res) => {
    const query = parsePaymentListQuery(req.query);
    res.status(200).json(await service.listMyPayments(req.auth.userId, req.auth.role, query));
  });

  router.get('/payments/:paymentId', noStore, authenticate, requireRole, async (req, res) => {
    const paymentId = parsePaymentId(req.params.paymentId);
    const data = await service.getPaymentForViewer(req.auth.userId, req.auth.role, paymentId);
    res.status(200).json({ data });
  });

  return router;
}
