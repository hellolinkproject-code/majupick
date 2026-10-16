import { apiClient } from './apiClient.js';

/**
 * AI-01 단가 분석 요청. 등록 전 퍼널 입력값으로도 호출한다(프로젝트 ID 없음).
 * @param {{ title: string, description: string, category?: string, techStackIds?: number[] }} payload
 * @returns {Promise<{ items: object[], totalAmount: string, assumptions?: string[], isMock: boolean }>}
 */
export async function requestPriceAnalysis(payload) {
  const res = await apiClient.post('/ai/price-analyses', payload);
  return res.data.data;
}
