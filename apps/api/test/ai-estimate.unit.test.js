import { describe, expect, it, vi } from 'vitest';
import { AiConfigError, loadAiConfig } from '../src/config/ai.js';
import {
  parseEstimateAmount,
  parseEstimateResponse,
  sumEstimatedAmounts,
} from '../src/modules/ai/estimate.schema.js';
import { createEstimateService } from '../src/modules/ai/estimate.service.js';
import { validatePriceAnalysisRequest } from '../src/modules/ai/estimate.validation.js';
import { createEstimateProvider } from '../src/modules/ai/providers/index.js';
import {
  analyzeWithMock,
  createMockEstimateProvider,
} from '../src/modules/ai/providers/mockProvider.js';
import { createOpenAiEstimateProvider } from '../src/modules/ai/providers/openaiProvider.js';
import { HttpError } from '../src/utils/httpError.js';

describe('loadAiConfig', () => {
  it('defaults to mock and does not require an API key', () => {
    const config = loadAiConfig({});
    expect(config.mode).toBe('mock');
    expect(config.openai.apiKey).toBeNull();
    expect(config.rateLimit.max).toBe(20);
  });

  it('rejects an unknown mode', () => {
    expect(() => loadAiConfig({ AI_ESTIMATE_MODE: 'gemini' })).toThrow(AiConfigError);
  });

  it('loads openai mode without logging or exposing the key in the config shape beyond apiKey', () => {
    const config = loadAiConfig({
      AI_ESTIMATE_MODE: 'openai',
      OPENAI_API_KEY: 'sk-test-not-for-logging',
      OPENAI_MODEL: 'gpt-test',
    });
    expect(config.mode).toBe('openai');
    expect(config.openai.model).toBe('gpt-test');
    expect(config.openai.apiKey).toBe('sk-test-not-for-logging');
  });
});

describe('estimate schema', () => {
  it('parses amounts and rejects non-positive values', () => {
    expect(parseEstimateAmount('800000')).toBe(800000n);
    expect(parseEstimateAmount(0)).toBeNull();
    expect(parseEstimateAmount('-1')).toBeNull();
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

describe('openai provider stub', () => {
  it('never calls the network and returns AI_UNAVAILABLE', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const provider = createOpenAiEstimateProvider({
      apiKey: 'sk-should-not-be-used',
      model: 'gpt-test',
    });
    await expect(
      provider.analyze({
        title: 't',
        description: 'd',
        category: 'WEB',
        techStackNames: [],
      }),
    ).rejects.toMatchObject({ status: 503, code: 'AI_UNAVAILABLE' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
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

  it('retries once on invalid provider JSON then fails with 502', async () => {
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
