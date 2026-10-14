import { apiClient } from './apiClient.js';
import { useSessionStore } from '../stores/useSessionStore.js';

// 저장 API는 갱신된 UserMe를 돌려주므로 세션 사용자(헤더 이름 등)도 바로 바꾼다.
function keepUser(res) {
  useSessionStore.getState().setUser(res.data.data);
  return res.data.data;
}

/** PROF-01 이름·자기소개 수정. */
export async function updateMe(changes) {
  return keepUser(await apiClient.patch('/users/me', changes));
}

export async function removeProfileImage() {
  return keepUser(await apiClient.patch('/users/me', { profileImageUrl: null }));
}

/** PROF-02. 필수 항목을 포함한 전체 값을 보낸다. */
export async function saveClientProfile(profile) {
  return keepUser(await apiClient.put('/users/me/client-profile', profile));
}

/** PROF-03. hourlyRate는 정밀도를 지키려고 숫자 문자열로 보낸다. */
export async function saveFreelancerProfile(profile) {
  return keepUser(await apiClient.put('/users/me/freelancer-profile', profile));
}

/**
 * PROF-04. 기본 헤더(JSON) 그대로면 axios가 FormData를 JSON으로 바꾸므로 multipart로 지정한다.
 * 브라우저가 boundary를 붙인 Content-Type을 직접 만든다.
 */
export async function uploadProfileImage(file) {
  const form = new FormData();
  form.append('file', file);
  return keepUser(
    await apiClient.post('/uploads/profile-image', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30_000,
    }),
  );
}

/** PROF-05 공개 프로필. 로그인 없이 읽으며 수정 API와 섞지 않는다. */
export async function fetchPublicProfile(userId) {
  const res = await apiClient.get(`/users/${encodeURIComponent(userId)}`);
  return res.data.data;
}

/** 사용자가 입력한 외부 링크는 http(s)일 때만 연다. */
export function externalUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

/** PROF-06. */
export async function fetchTechStacks(q) {
  const res = await apiClient.get('/tech-stacks', { params: { q: q || undefined, limit: 20 } });
  return res.data.data;
}

/** PROF-06 `ids`. URL에 남은 기술 스택 ID의 이름을 보여 줄 때 쓴다. 없는 ID는 빠진다. */
export async function fetchTechStacksByIds(ids) {
  const res = await apiClient.get('/tech-stacks', { params: { ids: ids.join(',') } });
  return res.data.data;
}

/** PROF-07. 같은 이름(정규화 기준)이 있으면 기존 항목을 돌려준다. */
export async function createTechStack(name) {
  const res = await apiClient.post('/tech-stacks', { name });
  return res.data.data;
}

/** SRCH-03 카테고리·사업 분야 선택지. */
export async function fetchMetaOptions() {
  const res = await apiClient.get('/meta/options');
  return res.data.data;
}

/** 서버가 준 이미지 경로(`/api/uploads/...`)를 API 서버가 다른 출처일 때도 열 수 있게 만든다. */
export function profileImageSrc(url) {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (!url || !base || !/^https?:\/\//.test(base)) return url;
  return new URL(url, base).toString();
}
