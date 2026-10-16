/**
 * OpenAI Responses API Structured Outputs용 JSON Schema.
 * 모델 필드명은 functions/assumptions/summary. 서버 DTO는 items로 매핑한다.
 */

export const PRICE_ESTIMATE_SCHEMA_NAME = 'workbridge_price_estimate';

export const PRICE_ESTIMATE_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['functions', 'assumptions', 'summary'],
  properties: {
    functions: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'estimatedAmount', 'rationale'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', minLength: 1, maxLength: 500 },
          /** 원화 양의 정수(십진 문자열). 예: "800000" */
          estimatedAmount: { type: 'string', pattern: '^[1-9][0-9]{0,17}$' },
          rationale: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
    assumptions: {
      type: 'array',
      maxItems: 10,
      items: { type: 'string', maxLength: 300 },
    },
    summary: { type: 'string', minLength: 1, maxLength: 500 },
  },
});

export const PRICE_ESTIMATE_TEXT_FORMAT = Object.freeze({
  type: 'json_schema',
  name: PRICE_ESTIMATE_SCHEMA_NAME,
  strict: true,
  schema: PRICE_ESTIMATE_JSON_SCHEMA,
});
