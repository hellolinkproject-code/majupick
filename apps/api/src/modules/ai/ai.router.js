import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { HttpError } from '../../utils/httpError.js';
import { createEstimateService } from './estimate.service.js';
import { validatePriceAnalysisRequest } from './estimate.validation.js';
import { createUsageLedger } from './usageLedger.js';

function onlyClient(req, _res, next) {
  if (req.auth.role === 'CLIENT') next();
  else next(new HttpError(403, 'FORBIDDEN', '의뢰인 계정만 AI 단가 분석을 요청할 수 있습니다.'));
}

/**
 * AI-01 POST /ai/price-analyses
 * @param {{ prisma: object, authConfig: object, aiConfig: ReturnType<import('../../config/ai.js').loadAiConfig>, provider: object }} deps
 */
export function createAiRouter({ prisma, authConfig, aiConfig, provider }) {
  const router = Router();
  const authenticate = createAuthenticate(authConfig);
  const requireRole = createRequireRole(prisma);
  const usageLedger = aiConfig.mode === 'openai' ? createUsageLedger({ prisma, aiConfig }) : null;
  const service = createEstimateService({ prisma, provider, aiConfig, usageLedger });

  const estimateLimiter = rateLimit({
    windowMs: aiConfig.rateLimit.windowMs,
    limit: aiConfig.rateLimit.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `ai-estimate:${req.auth.userId}`,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, _res, next) =>
      next(
        new HttpError(
          429,
          'RATE_LIMITED',
          'AI 단가 분석 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
        ),
      ),
  });

  const globalLimiter = rateLimit({
    windowMs: aiConfig.rateLimit.windowMs,
    limit: aiConfig.rateLimit.globalMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: () => 'ai-estimate:global',
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, _res, next) =>
      next(
        new HttpError(
          429,
          'RATE_LIMITED',
          'AI 단가 분석 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
        ),
      ),
  });

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post(
    '/price-analyses',
    authenticate,
    requireRole,
    onlyClient,
    estimateLimiter,
    globalLimiter,
    async (req, res) => {
      const input = validatePriceAnalysisRequest(req.body);
      const data = await service.analyzePrice(input, { userId: req.auth.userId });
      res.status(200).json({ data });
    },
  );

  return router;
}
