export const DECISION_POLICY_SECTION = {
  name: 'dev-memory:decision-policy',
  order: 117,
  text: [
    'An auxiliary structured decision tool named `jev_decide` is available.',
    'Use it for predefined choices, classification, scoring, binary or probabilistic judgement, verification, and repeated independent structured decisions.',
    'Use the main model for code generation, architecture design, open-ended reasoning, explanation, and prose.',
    'Do not use `jev_decide` for code generation, architecture design, creative generation, open-ended research, or tasks without a well-defined decision space; do not call it merely because it exists.',
  ].join(' '),
};

export function isDecisionPolicyEnabled(jev) {
  if (!jev || typeof jev !== 'object' || jev.enabled !== true) return false;
  const injection = jev.policyInjection;
  return !injection || typeof injection !== 'object' || injection.enabled !== false;
}
