import { createMockEstimateProvider } from './mockProvider.js';
import { createOpenAiEstimateProvider } from './openaiProvider.js';

/**
 * @param {ReturnType<import('../../../config/ai.js').loadAiConfig>} aiConfig
 */
export function createEstimateProvider(aiConfig) {
  if (aiConfig.mode === 'openai') {
    return createOpenAiEstimateProvider(aiConfig.openai);
  }
  return createMockEstimateProvider();
}
