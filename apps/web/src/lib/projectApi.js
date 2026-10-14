import { apiClient } from './apiClient.js';
import { criteriaToApiParams } from './projectSearch.js';

/**
 * SRCH-01 공개 검색(페이지당 10개). signal로 조건이 바뀐 이전 요청을 취소한다.
 * @returns {Promise<{ data: object[], pagination: object }>}
 */
export async function searchProjects(criteria, signal) {
  const res = await apiClient.get('/projects', { params: criteriaToApiParams(criteria), signal });
  return res.data;
}

/**
 * PRJ-01. 같은 idempotencyKey로 다시 보내면 서버가 새로 만들지 않고 처음 등록한 프로젝트를 돌려준다.
 * budget은 정밀도를 지키려고 숫자 문자열로 보낸다(D-51).
 */
export async function createProject(payload, idempotencyKey) {
  const res = await apiClient.post('/projects', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return res.data.data;
}

/** PRJ-02. 로그인했으면 토큰이 붙어 소유자에게는 내부 상태·가능한 동작이 함께 온다. */
export async function fetchProject(projectId) {
  const res = await apiClient.get(`/projects/${projectId}`);
  return res.data.data;
}

/** PRJ-03. 바뀐 항목만 보낸다. */
export async function updateProject(projectId, changes) {
  const res = await apiClient.patch(`/projects/${projectId}`, changes);
  return res.data.data;
}

/** PRJ-04 소프트 삭제. */
export async function deleteProject(projectId) {
  await apiClient.delete(`/projects/${projectId}`);
}

/** PRJ-05 내 프로젝트(페이지당 10개). */
export async function fetchMyProjects(page = 1) {
  const res = await apiClient.get('/me/projects', { params: { page } });
  return res.data;
}
