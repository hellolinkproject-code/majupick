import OpenAI from 'openai';

/**
 * 서버 전용 OpenAI 클라이언트. maxRetries:0 — 자동 재시도 없음.
 * 테스트에서는 createOpenAiClient 대신 fake client를 주입한다.
 *
 * @param {{ apiKey: string, timeoutMs: number }} opts
 */
export function createOpenAiClient({ apiKey, timeoutMs }) {
  return new OpenAI({
    apiKey,
    timeout: timeoutMs,
    maxRetries: 0,
  });
}
