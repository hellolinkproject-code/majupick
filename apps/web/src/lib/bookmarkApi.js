import { apiClient } from './apiClient.js';
import { projectQueryKey } from './projectApi.js';

/**
 * BMK-03 캐시 키. 사용자별로 나눠 다른 계정의 북마크가 보이지 않게 하고,
 * 로그아웃할 때 앞부분 `['bookmarks']`로 모두 지운다.
 */
export function bookmarksQueryKey(userId, page) {
  return page === undefined ? ['bookmarks', String(userId)] : ['bookmarks', String(userId), page];
}

/** BMK-01. 이미 저장돼 있어도 204(멱등). */
export async function addBookmark(projectId) {
  await apiClient.put(`/projects/${projectId}/bookmark`);
}

/** BMK-02. 이미 해제돼 있어도 204(멱등). */
export async function removeBookmark(projectId) {
  await apiClient.delete(`/projects/${projectId}/bookmark`);
}

/** BMK-03 내 북마크(최근 저장순, 페이지당 10개). */
export async function fetchMyBookmarks(page = 1) {
  const res = await apiClient.get('/me/bookmarks', { params: { page } });
  return res.data;
}

/**
 * 북마크 추가·해제가 성공한 뒤 같은 사용자의 상세 캐시를 바로 고치고 목록은 다시 받게 한다.
 * 상세와 내 북마크가 서로 다른 상태를 보여 주지 않게 하려는 것이다.
 */
export function applyBookmarkChange(queryClient, userId, projectId, isBookmarked) {
  queryClient.setQueryData(projectQueryKey(projectId, userId), (old) =>
    old ? { ...old, isBookmarked } : old,
  );
  queryClient.invalidateQueries({ queryKey: bookmarksQueryKey(userId) });
}

/** SRCH-02 캐시 키. 공개 응답이라 사용자별로 나누지 않는다. */
export function recommendationsQueryKey(projectId) {
  return ['project-recommendations', String(projectId)];
}

/** SRCH-02 추천 프로젝트(최대 4개, 모집 중인 공개 요약 + 일치 정보). */
export async function fetchRecommendations(projectId) {
  const res = await apiClient.get(`/projects/${projectId}/recommendations`);
  return res.data.data;
}
