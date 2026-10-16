import { HttpError } from '../../../utils/httpError.js';

/**
 * 향후 OpenAI 연결용 provider 골격(STEP 08-A).
 * 실제 HTTP/SDK 호출은 하지 않는다. 외부 비용·키 유출을 막기 위해 항상 503을 낸다.
 *
 * @param {{ apiKey: string | null, model: string }} openai
 */
export function createOpenAiEstimateProvider(openai) {
  return {
    name: 'openai',
    isMock: false,
    /**
     * @param {{ title: string, description: string, category: string | null, techStackNames: string[] }} _input
     */
    async analyze(_input) {
      // 키 존재 여부만 구분해 안내한다. 키 문자열 자체는 메시지·로그에 넣지 않는다.
      const configured = Boolean(openai?.apiKey);
      throw new HttpError(
        503,
        'AI_UNAVAILABLE',
        configured
          ? 'OpenAI 연동은 아직 활성화되지 않았습니다. AI_ESTIMATE_MODE=mock 으로 사용해 주세요.'
          : 'OpenAI API가 설정되지 않았거나 아직 연결되지 않았습니다. AI_ESTIMATE_MODE=mock 으로 사용해 주세요.',
      );
    },
  };
}
