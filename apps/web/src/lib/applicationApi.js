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

/** APP-02 지원자 목록(소유자 전용). 응답: { data, pagination, counts }. */
export async function fetchProjectApplications(projectId, { page = 1, status = null } = {}) {
  const res = await apiClient.get(`/projects/${projectId}/applications`, {
    params: { page, ...(status && { status }) },
  });
  return res.data;
}

export function projectApplicationsKey(projectId) {
  return ['project-applications', String(projectId)];
}

/** DEC-01 선정. 본문 없이 보낸다(합의 금액은 별도 제안). 응답: { application, autoRejectedCount }. */
export async function acceptApplication(applicationId) {
  const res = await apiClient.post(`/applications/${applicationId}/accept`);
  return res.data.data;
}

/** DEC-02 직접 거절. 본문 없이 보낸다(사유 입력 없음, D-49). */
export async function rejectApplication(applicationId) {
  const res = await apiClient.post(`/applications/${applicationId}/reject`);
  return res.data.data;
}

/** OFFER-01 합의 금액 제안(의뢰인). 금액은 문자열로 보낸다(D-51). */
export async function proposeOffer(applicationId, offerAmount) {
  const res = await apiClient.post(`/applications/${applicationId}/offer`, { offerAmount });
  return res.data.data;
}

/** CTR-01 합의 금액 동의 → 계약서 생성. */
export async function agreeOffer(applicationId) {
  const res = await apiClient.post(`/applications/${applicationId}/offer/agree`);
  return res.data.data;
}

/** CTR-02 합의 금액 거부. */
export async function declineOffer(applicationId) {
  const res = await apiClient.post(`/applications/${applicationId}/offer/decline`);
  return res.data.data;
}

/** CTR-04 계약서 조회(당사자). */
export async function fetchContract(contractId) {
  const res = await apiClient.get(`/contracts/${contractId}`);
  return res.data.data;
}
