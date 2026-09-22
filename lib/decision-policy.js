export const DECISION_POLICY_SECTION = {
  name: 'dev-memory:decision-policy',
  order: 117,
  text: [
    'An auxiliary structured decision tool named `jev_decide` is available.',
    'Use it for predefined choices, classification, scoring, binary or probabilistic judgement, verification, and repeated independent structured decisions.',
    'Do not use it for code generation, or to decide whether a session should record memory, or to generate memory content.',
    'The main model decides whether a durable proposal exists and writes its content.',
    'A write gate may separately accept or skip that proposal.',
    'Do not call `jev_decide` merely because it exists.',
  ].join(' '),
};

export function isDecisionPolicyEnabled(jev) {
  if (!jev || typeof jev !== 'object' || jev.enabled !== true) return false;
  const injection = jev.policyInjection;
  return !injection || typeof injection !== 'object' || injection.enabled !== false;
}
