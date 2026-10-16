import { billableBlockReason, canMakeBillableCalls } from '../../../config/ai.js';
import { HttpError } from '../../../utils/httpError.js';
import { ESTIMATE_DISCLAIMER, SYSTEM_PROMPT, buildUserPrompt } from '../openaiPrompt.js';
import { PRICE_ESTIMATE_TEXT_FORMAT } from '../openaiSchema.js';
import { createOpenAiClient } from './openaiClient.js';

/**
 * OpenAI 오류 → WorkBridge HttpError. 키·헤더·원문 body는 메시지에 넣지 않는다.
 * @param {unknown} error
 */
export function mapOpenAiError(error) {
  if (error instanceof HttpError) return error;

  const status = error?.status ?? error?.statusCode;
  const code = String(error?.code ?? error?.error?.code ?? '');
  const type = String(error?.type ?? error?.error?.type ?? '');
  const message = String(error?.message ?? '');

  if (
    status === 401 ||
    code === 'invalid_api_key' ||
    (type === 'invalid_request_error' && /api key/i.test(message))
  ) {
    return new HttpError(
      503,
      'AI_AUTH_FAILED',
      'AI 서비스 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
  if (status === 404 || /model/i.test(code) || /model_not_found/i.test(message)) {
    return new HttpError(
      503,
      'AI_MODEL_UNAVAILABLE',
      '요청한 AI 모델을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
  if (status === 429 || code === 'rate_limit_exceeded') {
    return new HttpError(
      429,
      'AI_PROVIDER_RATE_LIMITED',
      'AI 서비스 요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
  if (
    code === 'insufficient_quota' ||
    /billing|quota|spending limit/i.test(message) ||
    /billing|quota/i.test(type)
  ) {
    return new HttpError(
      503,
      'AI_PROVIDER_QUOTA',
      'AI 서비스 이용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
  if (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    error?.name === 'APIConnectionTimeoutError' ||
    /timeout/i.test(message)
  ) {
    return new HttpError(
      503,
      'AI_TIMEOUT',
      'AI 서비스 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
  if (
    error?.name === 'APIConnectionError' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    /network|fetch failed/i.test(message)
  ) {
    return new HttpError(
      503,
      'AI_NETWORK',
      'AI 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    );
  }

  return new HttpError(503, 'AI_UNAVAILABLE', 'AI 단가 분석을 사용할 수 없습니다.');
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }
  const outputs = Array.isArray(response?.output) ? response.output : [];
  for (const item of outputs) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const part of contents) {
      if (typeof part?.text === 'string' && part.text.trim()) return part.text;
      if (typeof part?.output_text === 'string' && part.output_text.trim()) return part.output_text;
    }
  }
  return null;
}

/**
 * Responses API usage. output_tokens에는 reasoning_tokens가 포함된다.
 * 필드가 어긋난 응답에도 과소 정산되지 않도록 max로 보수적으로 잡는다.
 * @param {object} response
 */
export function readUsage(response) {
  const usage = response?.usage ?? {};
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const reasoningTokens = Number(usage.output_tokens_details?.reasoning_tokens ?? 0) || 0;
  return {
    inputTokens,
    outputTokens: Math.max(outputTokens, reasoningTokens),
    reasoningTokens,
    requestId: typeof response?.id === 'string' ? response.id : null,
  };
}

function hasRefusal(response) {
  const outputs = Array.isArray(response?.output) ? response.output : [];
  for (const item of outputs) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const part of contents) {
      if (part?.type === 'refusal' || typeof part?.refusal === 'string') return true;
    }
  }
  return Boolean(response?.refusal);
}

function billableFailure(code, message, response) {
  return new HttpError(502, code, message, {
    billableAttempted: true,
    usage: readUsage(response),
  });
}

/**
 * @param {object} aiConfig loadAiConfig 결과(또는 openai 하위 호환)
 * @param {{ createClient?: Function, client?: object }} [deps] 테스트용 Fake Client 주입
 */
export function createOpenAiEstimateProvider(aiConfig, deps = {}) {
  // 하위 호환: 예전 테스트가 openai 조각만 넘긴 경우
  const config =
    aiConfig?.openai && aiConfig.mode
      ? aiConfig
      : {
          mode: 'openai',
          enableBillableCalls: false,
          monthlyBudgetMicroUsd: 0n,
          openai: aiConfig,
        };

  const createClient = deps.createClient ?? createOpenAiClient;

  return {
    name: 'openai',
    isMock: false,

    /**
     * @param {{ title: string, description: string, category: string | null, techStackNames: string[] }} input
     * @returns {Promise<{ items: object[], assumptions: string[], summary?: string, usage: object }>}
     */
    async analyze(input) {
      const block = billableBlockReason(config);
      if (block) {
        const status = block.code === 'AI_BUDGET_EXCEEDED' ? 429 : 503;
        throw new HttpError(status, block.code, block.message);
      }
      if (!canMakeBillableCalls(config)) {
        throw new HttpError(503, 'AI_BILLABLE_DISABLED', '유료 AI 호출이 허용되지 않았습니다.');
      }

      const { apiKey, model, timeoutMs, maxOutputTokens } = config.openai;
      const client = deps.client ?? createClient({ apiKey, timeoutMs });

      let response;
      try {
        response = await client.responses.create({
          model,
          store: false,
          max_output_tokens: maxOutputTokens,
          // gpt-6-luna: 견적 JSON에는 고노력 reasoning이 필요 없어 비용을 낮춘다.
          ...(model === 'gpt-6-luna' || model.startsWith('gpt-6-luna')
            ? { reasoning: { effort: 'low' } }
            : {}),
          // 도구·웹 검색 비활성: tools 미전달
          input: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(input) },
          ],
          text: { format: PRICE_ESTIMATE_TEXT_FORMAT },
        });
      } catch (error) {
        throw mapOpenAiError(error);
      }

      // incomplete/failed/refusal도 입력·reasoning 토큰이 과금됐을 수 있다 → 예약을 환불하지 않는다.
      if (response?.status === 'incomplete' || response?.status === 'failed') {
        throw billableFailure(
          'AI_INVALID_RESPONSE',
          'AI 응답이 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.',
          response,
        );
      }
      if (hasRefusal(response)) {
        throw billableFailure(
          'AI_INVALID_RESPONSE',
          'AI가 요청을 처리할 수 없습니다. 입력 내용을 바꾼 뒤 다시 시도해 주세요.',
          response,
        );
      }

      const text = extractOutputText(response);
      if (!text) {
        throw billableFailure(
          'AI_INVALID_RESPONSE',
          'AI 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.',
          response,
        );
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw billableFailure(
          'AI_INVALID_RESPONSE',
          'AI 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.',
          response,
        );
      }

      const functions = parsed.functions ?? parsed.items;
      const assumptions = Array.isArray(parsed.assumptions) ? [...parsed.assumptions] : [];
      if (!assumptions.some((line) => String(line).includes('참고용 예상 견적'))) {
        assumptions.push(ESTIMATE_DISCLAIMER);
      }
      if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
        assumptions.unshift(parsed.summary.trim());
      }

      return {
        items: functions,
        assumptions,
        summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
        usage: readUsage(response),
      };
    },
  };
}
