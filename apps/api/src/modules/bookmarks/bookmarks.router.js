import { Router } from 'express';
import { createAuthenticate } from '../../middlewares/authenticate.js';
import { createRequireRole } from '../../middlewares/requireRole.js';
import { HttpError } from '../../utils/httpError.js';
import { parsePage, parseProjectId } from '../projects/project.validation.js';
import { createBookmarkService } from './bookmark.service.js';

function onlyFreelancer(message) {
  return (req, _res, next) => {
    if (req.auth.role === 'FREELANCER') next();
    else next(new HttpError(403, 'FORBIDDEN', message));
  };
}

function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * BMK-01(`PUT /projects/:projectId/bookmark`), BMK-02(`DELETE /projects/:projectId/bookmark`),
 * BMK-03(`GET /me/bookmarks`). `/api` 바로 아래에 붙인다.
 * 확인 순서: 로그인(401) → 역할 선택(ROLE_REQUIRED) → 프리랜서(FORBIDDEN) → 프로젝트(404, 추가만).
 * 프리랜서 프로필 완성은 요구하지 않는다(D-106 제안). 본인 북마크만 다루며 다른 사용자 id는 받지 않는다.
 */
export function createBookmarksRouter({ prisma, authConfig, bookmarkService }) {
  const router = Router();
  const service = bookmarkService ?? createBookmarkService({ prisma });
  const guards = [
    noStore,
    createAuthenticate(authConfig),
    createRequireRole(prisma),
    onlyFreelancer('프리랜서 계정만 프로젝트를 북마크할 수 있습니다.'),
  ];

  router.put('/projects/:projectId/bookmark', ...guards, async (req, res) => {
    await service.addBookmark(req.auth.userId, parseProjectId(req.params.projectId));
    res.status(204).end();
  });

  router.delete('/projects/:projectId/bookmark', ...guards, async (req, res) => {
    await service.removeBookmark(req.auth.userId, parseProjectId(req.params.projectId));
    res.status(204).end();
  });

  router.get('/me/bookmarks', ...guards, async (req, res) => {
    res.json(await service.listMyBookmarks(req.auth.userId, parsePage(req.query.page)));
  });

  return router;
}
