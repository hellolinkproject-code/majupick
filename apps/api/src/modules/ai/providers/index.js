import { createMockEstimateProvider } from './mockProvider.js';
import { createOpenAiEstimateProvider } from './openaiProvider.js';

/**
 * @param {ReturnType<import('../../../config/ai.js').loadAiConfig>} aiConfig
 * @param {{ createClient?: Function, client?: object }} [openaiDeps]
 */
export function createEstimateProvider(aiConfig, openaiDeps = {}) {
  if (aiConfig.mode === 'openai') {
    return createOpenAiEstimateProvider(aiConfig, openaiDeps);
  }
  return createMockEstimateProvider();
}
