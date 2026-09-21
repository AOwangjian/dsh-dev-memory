function jsonRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value) {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

function requireState(state) {
  if (typeof state === 'string' && state.trim()) return;
  if (state && typeof state === 'object' && isJsonValue(state)) return;
  throw new Error('jev_decide.state must be a non-empty string, object, or array');
}

function requireQuestion(id, question) {
  if (!isPlainObject(question)) throw new Error(`jev_decide.questions.${id} must be an object`);
  if (!['choice', 'score', 'noul'].includes(question.type)) {
    throw new Error(`jev_decide.questions.${id}.type must be choice, score, or noul`);
  }
  const instructions = question.instructions;
  if (!(typeof instructions === 'string' && instructions.trim()) && !(instructions && typeof instructions === 'object' && isJsonValue(instructions))) {
    throw new Error(`jev_decide.questions.${id}.instructions must be a non-empty JSON value`);
  }
  if (question.type === 'choice' && (!isPlainObject(question.criteria) || Object.keys(question.criteria).length < 2)) {
    throw new Error(`jev_decide.questions.${id}.criteria must define at least two choices`);
  }
  if (question.type === 'score' && (!Array.isArray(question.criteria) || question.criteria.length < 2)) {
    throw new Error(`jev_decide.questions.${id}.criteria must define at least two score levels`);
  }
  if (question.criteria !== undefined && !isJsonValue(question.criteria)) {
    throw new Error(`jev_decide.questions.${id}.criteria must be JSON-serializable`);
  }
}

function validateArgs(args) {
  if (!isPlainObject(args)) throw new Error('jev_decide arguments must be an object');
  requireState(args.state);
  if (!isPlainObject(args.questions) || Object.keys(args.questions).length === 0) {
    throw new Error('jev_decide.questions must be a non-empty object');
  }
  for (const [id, question] of Object.entries(args.questions)) requireQuestion(id, question);
}

function confidenceByQuestion(result) {
  if (!result || result.ok !== true || !isPlainObject(result.answers)) return undefined;
  const confidence = {};
  for (const [id, answer] of Object.entries(result.answers)) {
    if (isPlainObject(answer) && Number.isFinite(answer.confidence)) confidence[id] = answer.confidence;
  }
  return Object.keys(confidence).length ? confidence : undefined;
}

export function makeJevTool({ service, onResult } = {}) {
  return {
    name: 'jev_decide',
    description: 'Make structured decisions for bounded choices, classification, scoring, binary or probabilistic judgement, verification, and repeated independent decisions. Do not use for code generation, prose, architecture design, creative generation, or open-ended research.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: { type: ['string', 'object', 'array'], description: 'The state to evaluate.' },
        questions: {
          type: 'object',
          minProperties: 1,
          description: 'Named Choice, Score, or Noul questions to evaluate against the same state.',
          additionalProperties: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['choice', 'score', 'noul'] },
              instructions: {},
              criteria: {},
            },
            required: ['type', 'instructions'],
          },
        },
      },
      required: ['state', 'questions'],
    },
    output: { schema: {}, render: jsonRender },
    async execute(args = {}) {
      validateArgs(args);
      const startedAt = Date.now();
      const result = await service.decide(args);
      const telemetry = {
        event: 'jev_tool_called',
        decisionTypes: [...new Set(Object.values(args.questions).map((question) => question.type))],
        latencyMs: Date.now() - startedAt,
        success: result && result.ok === true,
        confidence: confidenceByQuestion(result),
        errorCategory: result && result.error ? result.error.category : undefined,
      };
      if (typeof onResult === 'function') {
        try {
          onResult(telemetry);
        } catch {
          /* observability must never change the decision result */
        }
      }
      return { ...result, telemetry };
    },
  };
}
