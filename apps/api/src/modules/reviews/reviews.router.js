import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { parseContractId } from '../contracts/contract.validation.js';
import { parseUserId } from '../profiles/publicProfile.js';
import { createReviewService } from './review.service.js';

function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * REV-01 POST /contracts/:contractId/reviews
 * REV-02 GET /contracts/:contractId/reviews
 * REV-03 GET /users/:userId/reviews
 */
export function createReviewsRouter({ prisma, authConfig, reviewService }) {
  const router = Router();
  const service = reviewService ?? createReviewService({ prisma });
  const authenticate = createAuthenticate(authConfig);
  const requireRole = createRequireRole(prisma);

  router.post(
    '/contracts/:contractId/reviews',
    noStore,
    authenticate,
    requireRole,
    async (req, res) => {
      const contractId = parseContractId(req.params.contractId);
      const data = await service.createReview(req.auth.userId, req.auth.role, contractId, req.body);
      res.status(201).json({ data });
    },
  );

  router.get(
    '/contracts/:contractId/reviews',
    noStore,
    authenticate,
    requireRole,
    async (req, res) => {
      const contractId = parseContractId(req.params.contractId);
      const data = await service.getContractReviews(req.auth.userId, contractId);
      res.status(200).json({ data });
    },
  );

  router.get('/users/:userId/reviews', async (req, res) => {
    const userId = parseUserId(req.params.userId);
    res.status(200).json(await service.listUserReviews(userId, req.query));
  });

  return router;
}
