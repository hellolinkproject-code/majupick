import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { parseTechStackQuery, validateTechStackName } from '../profiles/profile.validation.js';
import { normalizeTechStackName } from './techStack.js';

const PUBLIC_FIELDS = { id: true, name: true, isCustom: true };

/** PROF-06 검색(공개), PROF-07 커스텀 추가(로그인 + 역할). */
export function createTechStacksRouter({ prisma, authConfig }) {
  const router = Router();
  const authenticate = createAuthenticate(authConfig);
  const requireRole = createRequireRole(prisma);

  router.get('/', async (req, res) => {
    const { q, limit } = parseTechStackQuery(req.query);
    const normalized = q ? normalizeTechStackName(q) : '';
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            ...(normalized ? [{ normalizedName: { contains: normalized } }] : []),
          ],
        }
      : {};
    const techStacks = await prisma.techStack.findMany({
      where,
      select: PUBLIC_FIELDS,
      orderBy: [{ isCustom: 'asc' }, { name: 'asc' }],
      take: limit,
    });
    res.json({ data: techStacks });
  });

  /** 정규화 이름이 같은 항목이 있으면 새로 만들지 않고 그 항목을 200으로 돌려준다. */
  router.post('/', authenticate, requireRole, async (req, res) => {
    const { name, normalizedName } = validateTechStackName(req.body);
    const existing = await prisma.techStack.findUnique({
      where: { normalizedName },
      select: PUBLIC_FIELDS,
    });
    if (existing) {
      res.status(200).json({ data: existing });
      return;
    }
    try {
      const created = await prisma.techStack.create({
        data: { name, normalizedName, isCustom: true, createdById: req.auth.userId },
        select: PUBLIC_FIELDS,
      });
      res.status(201).json({ data: created });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      const raced = await prisma.techStack.findUnique({
        where: { normalizedName },
        select: PUBLIC_FIELDS,
      });
      res.status(200).json({ data: raced });
    }
  });

  return router;
}
