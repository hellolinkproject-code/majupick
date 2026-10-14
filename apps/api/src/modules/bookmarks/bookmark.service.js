import { HttpError } from '../../utils/httpError.js';
import {
  pagination,
  searchSelect,
  toSearchItem,
  withCurrentStatus,
} from '../projects/project.service.js';
import { PUBLIC_PROJECT_WHERE, todayKst } from '../projects/projectStatus.js';

/** BMK-03 페이지당 개수(내 프로젝트·지원 현황과 같다). */
export const MY_BOOKMARKS_PAGE_SIZE = 10;

const projectNotFound = () => new HttpError(404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');

/**
 * 내 북마크 한 건. 공개 검색 카드(설명 앞부분 포함)와 같은 범위 + 저장 시각 + 본인 지원 상태.
 * 상태는 오늘(KST) 기준 공개 상태라 마감된 프로젝트를 모집 중으로 보여 주지 않는다.
 */
export function toBookmarkItem(bookmark, today) {
  const { project } = bookmark;
  const application = project.applications?.[0] ?? null;
  return {
    ...toSearchItem(withCurrentStatus(project, today)),
    isBookmarked: true,
    bookmarkedAt: bookmark.createdAt,
    myApplication: application ? { id: application.id, status: application.status } : null,
  };
}

/**
 * BMK-01~03. 추가·해제는 "이 상태로 만들어 달라"는 요청이라 몇 번을 보내도 결과가 같다(멱등).
 * 프로젝트가 삭제·취소돼도 북마크 행은 지우지 않고, 목록에서만 공개 범위(PRJ-02·SRCH-01)로 거른다.
 */
export function createBookmarkService({ prisma, now = () => new Date() }) {
  return {
    /**
     * BMK-01. 공개 범위의 프로젝트만 저장한다(삭제·취소·없음은 404). 마감된 프로젝트도 공개 상세처럼 저장할 수 있다.
     * 프로젝트 행을 FOR SHARE로 잠가 확인과 저장 사이에 삭제가 끼어들지 못하게 한다.
     * 이미 저장돼 있으면 아무것도 바꾸지 않는다(저장 시각 유지).
     */
    async addBookmark(userId, projectId) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR SHARE`;
        const project = await tx.project.findFirst({
          where: { id: projectId, ...PUBLIC_PROJECT_WHERE },
          select: { id: true },
        });
        if (!project) throw projectNotFound();
        await tx.bookmark.createMany({ data: [{ userId, projectId }], skipDuplicates: true });
      });
    },

    /** BMK-02. 본인 행만 지운다. 없거나 프로젝트가 삭제됐어도 204(이미 원하는 상태). */
    async removeBookmark(userId, projectId) {
      await prisma.bookmark.deleteMany({ where: { userId, projectId } });
    },

    /**
     * BMK-03 내 북마크(최근 저장순, 페이지당 10개). 삭제·취소된 프로젝트는 공개 범위 밖이라 빼고 개수에도 넣지 않는다.
     * 개수와 목록을 같은 스냅샷(REPEATABLE READ)에서 읽는다. DB는 바꾸지 않는다.
     */
    async listMyBookmarks(userId, page) {
      const today = todayKst(now());
      const where = { userId, project: PUBLIC_PROJECT_WHERE };
      const [totalCount, bookmarks] = await prisma.$transaction(
        [
          prisma.bookmark.count({ where }),
          prisma.bookmark.findMany({
            where,
            select: {
              createdAt: true,
              project: {
                select: {
                  ...searchSelect,
                  applications: {
                    where: { freelancerId: userId },
                    select: { id: true, status: true },
                  },
                },
              },
            },
            orderBy: [{ createdAt: 'desc' }, { projectId: 'desc' }],
            skip: (page - 1) * MY_BOOKMARKS_PAGE_SIZE,
            take: MY_BOOKMARKS_PAGE_SIZE,
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      return {
        data: bookmarks.map((bookmark) => toBookmarkItem(bookmark, today)),
        pagination: pagination(page, MY_BOOKMARKS_PAGE_SIZE, totalCount),
      };
    },
  };
}
