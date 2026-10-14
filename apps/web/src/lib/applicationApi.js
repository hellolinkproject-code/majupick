import { apiClient } from './apiClient.js';

/**
 * APP-01 지원서 제출. 지원자는 서버가 토큰으로 정하므로 본문에는 입력 항목만 보낸다.
 * 금액은 정밀도를 지키려고 숫자 문자열로 보낸다(D-51).
 */
export async function applyToProject(projectId, payload) {
  const res = await apiClient.post(`/projects/${projectId}/applications`, payload);
  return res.data.data;
}

/** APP-04 내 지원 현황(최신 지원순, 페이지당 10개). */
export async function fetchMyApplications(page = 1) {
  const res = await apiClient.get('/me/applications', { params: { page } });
  return res.data;
}
