export const DECISION_POLICY_SECTION = {
  name: 'dev-memory:decision-policy',
  order: 117,
  text: [
    'An auxiliary structured decision tool named `jev_decide` is available.',
    'Use it for predefined choices, classification, scoring, binary or probabilistic judgement, verification, and repeated independent structured decisions.',
    'Use the main model for code generation, architecture design, open-ended reasoning, explanation, and prose.',
    'For memory-relevant work, retrieve candidate project memory first when needed, then use structured decisions to assess relevance, whether memory is durable enough to persist, and whether a health issue needs attention.',
    'Do not use Jev to perform deterministic filesystem operations; the main model remains responsible for final agent actions and written content.',
    'When reporting memory or decision results, lead with a concise conclusion and use compact Markdown tables for metrics, options, and priorities. Do not repeat raw JSON or restate every intermediate observation in prose.',
    'Do not use `jev_decide` for code generation, architecture design, creative generation, open-ended research, or tasks without a well-defined decision space; do not call it merely because it exists.',
  ].join(' '),
};

export function isDecisionPolicyEnabled(jev) {
  if (!jev || typeof jev !== 'object' || jev.enabled !== true) return false;
  const injection = jev.policyInjection;
  return !injection || typeof injection !== 'object' || injection.enabled !== false;
}
