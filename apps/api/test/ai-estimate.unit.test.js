import { describe, expect, it, vi } from 'vitest';
import {
  AiConfigError,
  billableBlockReason,
  canMakeBillableCalls,
  estimateCostMicroUsd,
  loadAiConfig,
  usdToMicroUsd,
} from '../src/config/ai.js';
import {
  parseEstimateAmount,
  parseEstimateResponse,
  sumEstimatedAmounts,
} from '../src/modules/ai/estimate.schema.js';
import { createEstimateService } from '../src/modules/ai/estimate.service.js';
import { validatePriceAnalysisRequest } from '../src/modules/ai/estimate.validation.js';
import { ESTIMATE_DISCLAIMER } from '../src/modules/ai/openaiPrompt.js';
import { PRICE_ESTIMATE_TEXT_FORMAT } from '../src/modules/ai/openaiSchema.js';
import { createEstimateProvider } from '../src/modules/ai/providers/index.js';
import {
  analyzeWithMock,
  createMockEstimateProvider,
} from '../src/modules/ai/providers/mockProvider.js';
import {
  createOpenAiEstimateProvider,
  mapOpenAiError,
  readUsage,
} from '../src/modules/ai/providers/openaiProvider.js';
import { HttpError } from '../src/utils/httpError.js';

const billableEnv = {
  AI_ESTIMATE_MODE: 'openai',
  AI_ENABLE_BILLABLE_CALLS: 'true',
  AI_ESTIMATE_MONTHLY_BUDGET_USD: '10',
  OPENAI_API_KEY: 'sk-test-not-for-logging',
  OPENAI_MODEL: 'gpt-6-luna',
};

function fakeSuccessClient(overrides = {}) {
  const create = vi.fn(async () => ({
    id: 'resp_test_1',
    status: 'completed',
    output_text: JSON.stringify({
      functions: [
        {
          name: '화면 UI',
          description: '주요 화면',
          estimatedAmount: '1000000',
          rationale: '약 5일',
        },
        {
          name: 'API',
          description: 'CRUD',
          estimatedAmount: '1500000',
          rationale: '약 6일',
        },
      ],
      assumptions: ['가정 1'],
      summary: ESTIMATE_DISCLAIMER,
      ...overrides.body,
    }),
    usage: { input_tokens: 120, output_tokens: 80, ...overrides.usage },
  }));
  return { responses: { create }, create };
}

describe('loadAiConfig', () => {
  it('defaults to mock with billable calls disabled and zero budget', () => {
    const config = loadAiConfig({});
    expect(config.mode).toBe('mock');
    expect(config.enableBillableCalls).toBe(false);
    expect(config.monthlyBudgetMicroUsd).toBe(0n);
    expect(config.openai.apiKey).toBeNull();
    expect(config.openai.model).toBe('gpt-6-luna');
    expect(canMakeBillableCalls(config)).toBe(false);
  });

  it('rejects an unknown mode', () => {
    expect(() => loadAiConfig({ AI_ESTIMATE_MODE: 'gemini' })).toThrow(AiConfigError);
  });

  it('loads openai mode and luna default pricing without exposing the key elsewhere', () => {
    const config = loadAiConfig(billableEnv);
    expect(config.mode).toBe('openai');
    expect(config.openai.model).toBe('gpt-6-luna');
    expect(config.openai.apiKey).toBe('sk-test-not-for-logging');
    expect(config.openai.pricing.inputMicroUsdPer1MTokens).toBe(usdToMicroUsd(0.1));
    expect(canMakeBillableCalls(config)).toBe(true);
  });

  it('blocks billable calls when only mode or key is set', () => {
    expect(
      canMakeBillableCalls(loadAiConfig({ AI_ESTIMATE_MODE: 'openai', OPENAI_API_KEY: 'sk-x' })),
    ).toBe(false);
    expect(
      billableBlockReason(loadAiConfig({ AI_ESTIMATE_MODE: 'openai', OPENAI_API_KEY: 'sk-x' }))
        .code,
    ).toBe('AI_BILLABLE_DISABLED');
    expect(
      billableBlockReason(
        loadAiConfig({
          ...billableEnv,
          AI_ESTIMATE_MONTHLY_BUDGET_USD: '0',
        }),
      ).code,
    ).toBe('AI_BUDGET_EXCEEDED');
  });

  it('requires explicit pricing for unknown models', () => {
    const config = loadAiConfig({
      ...billableEnv,
      OPENAI_MODEL: 'gpt-unknown-model',
    });
    expect(config.openai.pricing).toBeNull();
    expect(billableBlockReason(config).code).toBe('AI_PRICING_UNCONFIGURED');
  });
});

describe('estimateCostMicroUsd', () => {
  it('computes integer micro-USD from token counts', () => {
    const pricing = loadAiConfig(billableEnv).openai.pricing;
    const cost = estimateCostMicroUsd(1_000_000n, 1_000_000n, pricing);
    expect(cost).toBe(usdToMicroUsd(0.1) + usdToMicroUsd(0.5));
  });
});

describe('estimate schema', () => {
  it('parses amounts and rejects non-positive values', () => {
    expect(parseEstimateAmount('800000')).toBe(800000n);
    expect(parseEstimateAmount(0)).toBeNull();
    expect(parseEstimateAmount('-1')).toBeNull();
  });

  it('accepts functions alias and rejects duplicates', () => {
    const ok = parseEstimateResponse({
      functions: [
        {
          name: 'A',
          description: 'desc a',
          estimatedAmount: '100',
          rationale: 'one day',
        },
        {
          name: 'B',
          description: 'desc b',
          estimatedAmount: '250',
          rationale: 'two days',
        },
      ],
      assumptions: [],
    });
    expect(ok.ok).toBe(true);
    expect(sumEstimatedAmounts(ok.items)).toBe(350n);

    const dup = parseEstimateResponse({
      items: [
        { name: 'A', description: 'd', estimatedAmount: '1', rationale: 'r' },
        { name: 'a', description: 'd', estimatedAmount: '2', rationale: 'r' },
      ],
    });
    expect(dup.ok).toBe(false);
  });

  it('sums item amounts and ignores a forged total from the model', () => {
    const parsed = parseEstimateResponse({
      items: [
        {
          name: 'A',
          description: 'desc a',
          estimatedAmount: '100',
          rationale: 'one day',
        },
        {
          name: 'B',
          description: 'desc b',
          estimatedPrice: '250',
          rationale: 'two days',
        },
      ],
      totalAmount: '999999',
    });
    expect(parsed.ok).toBe(true);
    expect(sumEstimatedAmounts(parsed.items)).toBe(350n);
  });

  it('rejects malformed items', () => {
    expect(parseEstimateResponse({ items: [] }).ok).toBe(false);
    expect(
      parseEstimateResponse({
        items: [{ name: 'A', description: 'd', estimatedAmount: 'x', rationale: 'r' }],
      }).ok,
    ).toBe(false);
  });
});

describe('validatePriceAnalysisRequest', () => {
  it('accepts title and description with optional category and stacks', () => {
    expect(
      validatePriceAnalysisRequest({
        title: '  쇼핑몰 ',
        description: ' 반응형 리뉴얼 ',
        category: 'WEB',
        techStackIds: [1, 2],
      }),
    ).toEqual({
      title: '쇼핑몰',
      description: '반응형 리뉴얼',
      category: 'WEB',
      techStackIds: [1, 2],
    });
  });

  it('requires title and description', () => {
    try {
      validatePriceAnalysisRequest({ title: '', description: '' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error.status).toBe(400);
      expect(error.details.fields.title).toBeTruthy();
      expect(error.details.fields.description).toBeTruthy();
    }
  });
});

describe('mock provider', () => {
  it('returns the same result for the same input', async () => {
    const input = {
      title: '쇼핑몰 리뉴얼',
      description: '반응형 쇼핑몰과 관리자',
      category: 'WEB',
      techStackNames: ['React', 'Node.js'],
    };
    const a = await analyzeWithMock(input);
    const b = await analyzeWithMock(input);
    expect(a).toEqual(b);
    expect(a.items.length).toBeGreaterThanOrEqual(3);
    expect(a.items.some((item) => item.name.includes('기술 스택'))).toBe(true);
    expect(sumEstimatedAmounts(a.items) > 0n).toBe(true);
  });

  it('is selected by the factory in mock mode', () => {
    const provider = createEstimateProvider(loadAiConfig({ AI_ESTIMATE_MODE: 'mock' }));
    expect(provider.name).toBe('mock');
    expect(provider.isMock).toBe(true);
  });
});

describe('openai provider gate and fake client', () => {
  it('never calls the network when billable calls are disabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const createClient = vi.fn();
    const provider = createOpenAiEstimateProvider(
      loadAiConfig({
        AI_ESTIMATE_MODE: 'openai',
        OPENAI_API_KEY: 'sk-should-not-be-used',
      }),
      { createClient },
    );
    await expect(
      provider.analyze({
        title: 't',
        description: 'd',
        category: 'WEB',
        techStackNames: [],
      }),
    ).rejects.toMatchObject({ status: 503, code: 'AI_BILLABLE_DISABLED' });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('blocks zero budget and missing key without leaking secrets', async () => {
    const provider = createEstimateProvider(
      loadAiConfig({
        AI_ESTIMATE_MODE: 'openai',
        AI_ENABLE_BILLABLE_CALLS: 'true',
        AI_ESTIMATE_MONTHLY_BUDGET_USD: '5',
        OPENAI_API_KEY: 'sk-secret-must-not-appear',
      }),
    );
    // budget>0 but we test key leak on disabled path via billable false
    const gated = createOpenAiEstimateProvider(
      loadAiConfig({
        AI_ESTIMATE_MODE: 'openai',
        AI_ENABLE_BILLABLE_CALLS: 'true',
        OPENAI_API_KEY: 'sk-secret-must-not-appear',
        AI_ESTIMATE_MONTHLY_BUDGET_USD: '0',
      }),
    );
    try {
      await gated.analyze({
        title: 't',
        description: 'd',
        category: null,
        techStackNames: [],
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
      expect(error.message).not.toContain('sk-secret');
      expect(JSON.stringify(error)).not.toContain('sk-secret');
    }
    expect(provider.name).toBe('openai');
  });

  it('parses Structured Outputs from a fake client and does not retry', async () => {
    const fake = fakeSuccessClient();
    const config = loadAiConfig(billableEnv);
    const provider = createOpenAiEstimateProvider(config, { client: fake });
    const result = await provider.analyze({
      title: '쇼핑몰',
      description: '반응형',
      category: 'WEB',
      techStackNames: ['React'],
    });
    expect(result.items).toHaveLength(2);
    expect(result.usage.inputTokens).toBe(120);
    expect(fake.create).toHaveBeenCalledTimes(1);
    const params = fake.create.mock.calls[0][0];
    expect(params.store).toBe(false);
    expect(params.tools).toBeUndefined();
    expect(params.reasoning).toEqual({ effort: 'low' });
    expect(params.text.format).toEqual(PRICE_ESTIMATE_TEXT_FORMAT);
    expect(params.model).toBe('gpt-6-luna');
  });

  it('counts reasoning tokens inside billable output usage', () => {
    const usage = readUsage({
      id: 'resp_r',
      usage: {
        input_tokens: 75,
        output_tokens: 1186,
        output_tokens_details: { reasoning_tokens: 1024 },
      },
    });
    expect(usage.inputTokens).toBe(75);
    expect(usage.outputTokens).toBe(1186);
    expect(usage.reasoningTokens).toBe(1024);
  });

  it('marks incomplete responses as billable attempts with usage', async () => {
    const create = vi.fn(async () => ({
      id: 'resp_incomplete',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      usage: {
        input_tokens: 80,
        output_tokens: 500,
        output_tokens_details: { reasoning_tokens: 480 },
      },
    }));
    const provider = createOpenAiEstimateProvider(loadAiConfig(billableEnv), {
      client: { responses: { create } },
    });
    try {
      await provider.analyze({ title: 't', description: 'd', category: null, techStackNames: [] });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'AI_INVALID_RESPONSE' });
      expect(error.details.billableAttempted).toBe(true);
      expect(error.details.usage.outputTokens).toBe(500);
      expect(error.details.usage.requestId).toBe('resp_incomplete');
    }
  });

  it('maps timeout and 429 without retry', async () => {
    const timeoutErr = Object.assign(new Error('Request timed out'), {
      name: 'APIConnectionTimeoutError',
    });
    expect(mapOpenAiError(timeoutErr)).toMatchObject({ code: 'AI_TIMEOUT', status: 503 });

    const rateErr = Object.assign(new Error('rate'), { status: 429, code: 'rate_limit_exceeded' });
    expect(mapOpenAiError(rateErr)).toMatchObject({
      code: 'AI_PROVIDER_RATE_LIMITED',
      status: 429,
    });

    const create = vi.fn(async () => {
      throw rateErr;
    });
    const provider = createOpenAiEstimateProvider(loadAiConfig(billableEnv), {
      client: { responses: { create } },
    });
    await expect(
      provider.analyze({ title: 't', description: 'd', category: null, techStackNames: [] }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_RATE_LIMITED' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('createEstimateService', () => {
  const prisma = {
    techStack: {
      findMany: vi.fn(async ({ where }) => where.id.in.map((id) => ({ id, name: `Stack${id}` }))),
    },
  };

  it('recomputes totalAmount from items and marks mock results', async () => {
    const service = createEstimateService({ prisma, provider: createMockEstimateProvider() });
    const result = await service.analyzePrice({
      title: '데이터 대시보드',
      description: '지표 시각화',
      category: 'DATA_AI',
      techStackIds: [1],
    });
    const sum = result.items.reduce((acc, item) => acc + BigInt(item.estimatedAmount), 0n);
    expect(result.totalAmount).toBe(sum.toString());
    expect(result.isMock).toBe(true);
  });

  it('keeps totals exact for amounts beyond Number.MAX_SAFE_INTEGER', async () => {
    const huge = 9_007_199_254_740_993n;
    const provider = {
      name: 'huge-mock',
      isMock: true,
      analyze: async () => ({
        items: [
          {
            name: 'A',
            description: 'desc',
            estimatedAmount: huge,
            rationale: 'big',
          },
          {
            name: 'B',
            description: 'desc',
            estimatedAmount: 7n,
            rationale: 'small',
          },
        ],
        assumptions: [],
      }),
    };
    const service = createEstimateService({ prisma, provider });
    const result = await service.analyzePrice({
      title: 't',
      description: 'd',
      category: null,
      techStackIds: [],
    });
    expect(result.totalAmount).toBe((huge + 7n).toString());
    expect(Number.isSafeInteger(Number(result.totalAmount))).toBe(false);
  });

  it('retries once on invalid mock provider JSON then fails with 502', async () => {
    const provider = {
      name: 'broken',
      isMock: true,
      analyze: vi.fn(async () => ({ items: 'nope' })),
    };
    const service = createEstimateService({ prisma, provider });
    await expect(
      service.analyzePrice({
        title: 't',
        description: 'd',
        category: null,
        techStackIds: [],
      }),
    ).rejects.toMatchObject({ status: 502, code: 'AI_INVALID_RESPONSE' });
    expect(provider.analyze).toHaveBeenCalledTimes(2);
  });

  it('does not retry OpenAI API after a successful HTTP response with bad JSON', async () => {
    const create = vi.fn(async () => ({
      id: 'resp_bad',
      status: 'completed',
      output_text: '{"functions":[]}',
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    const aiConfig = loadAiConfig(billableEnv);
    const provider = createOpenAiEstimateProvider(aiConfig, {
      client: { responses: { create } },
    });
    const usageLedger = {
      reserve: vi.fn(async () => ({ id: 1n, reservedMicroUsd: 100n, monthKey: '2026-10' })),
      settle: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
      markUncertain: vi.fn(async () => {}),
    };
    const service = createEstimateService({ prisma, provider, aiConfig, usageLedger });
    await expect(
      service.analyzePrice(
        { title: 't', description: 'd', category: null, techStackIds: [] },
        { userId: 1 },
      ),
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(usageLedger.settle).toHaveBeenCalled();
  });

  it('settles usage when incomplete OpenAI response was already billed', async () => {
    const create = vi.fn(async () => ({
      id: 'resp_inc2',
      status: 'incomplete',
      usage: {
        input_tokens: 40,
        output_tokens: 200,
        output_tokens_details: { reasoning_tokens: 180 },
      },
    }));
    const aiConfig = loadAiConfig(billableEnv);
    const provider = createOpenAiEstimateProvider(aiConfig, {
      client: { responses: { create } },
    });
    const usageLedger = {
      reserve: vi.fn(async () => ({ id: 3n, reservedMicroUsd: 500n, monthKey: '2026-10' })),
      settle: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
      markUncertain: vi.fn(async () => {}),
    };
    const service = createEstimateService({ prisma, provider, aiConfig, usageLedger });
    await expect(
      service.analyzePrice(
        { title: 't', description: 'd', category: null, techStackIds: [] },
        { userId: 1 },
      ),
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(usageLedger.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3n }),
      expect.objectContaining({ outputTokens: 200, requestId: 'resp_inc2' }),
    );
    expect(usageLedger.release).not.toHaveBeenCalled();
  });

  it('settles usage on OpenAI fake success and recomputes total', async () => {
    const fake = fakeSuccessClient();
    const aiConfig = loadAiConfig(billableEnv);
    const provider = createOpenAiEstimateProvider(aiConfig, { client: fake });
    const usageLedger = {
      reserve: vi.fn(async () => ({ id: 2n, reservedMicroUsd: 500n, monthKey: '2026-10' })),
      settle: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
      markUncertain: vi.fn(async () => {}),
    };
    const service = createEstimateService({ prisma, provider, aiConfig, usageLedger });
    const result = await service.analyzePrice(
      { title: 't', description: '충분히 긴 설명', category: 'WEB', techStackIds: [] },
      { userId: 9 },
    );
    expect(result.totalAmount).toBe('2500000');
    expect(result.isMock).toBe(false);
    expect(usageLedger.reserve).toHaveBeenCalledWith({ userId: 9 });
    expect(usageLedger.settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2n }),
      expect.objectContaining({ inputTokens: 120, outputTokens: 80 }),
    );
  });

  it('rejects unknown tech stack ids', async () => {
    const missingPrisma = {
      techStack: { findMany: vi.fn(async () => [{ id: 1, name: 'React' }]) },
    };
    const service = createEstimateService({
      prisma: missingPrisma,
      provider: createMockEstimateProvider(),
    });
    await expect(
      service.analyzePrice({
        title: 't',
        description: 'd',
        category: 'WEB',
        techStackIds: [1, 99],
      }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });
});
