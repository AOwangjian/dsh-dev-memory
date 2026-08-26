export const CATEGORIES = ['fact', 'pitfall', 'open_question', 'changelog'];
export const CONFIDENCE_MIN = 'medium';
const RANK = { low: 0, medium: 1, high: 2 };

export function validateProposal(p) {
  if (!p || typeof p !== 'object') return { accept: false, reason: 'empty proposal' };
  if (!CATEGORIES.includes(p.category)) return { accept: false, reason: 'unknown category' };
  if (p.category === 'changelog') return { accept: false, reason: 'changelog 不落盘' };
  if (!Array.isArray(p.evidence) || p.evidence.length === 0) return { accept: false, reason: '无证据清单' };
  if (RANK[p.confidence] < RANK[CONFIDENCE_MIN]) return { accept: false, reason: '置信度低于 medium' };
  if (!p.module || typeof p.module !== 'string') return { accept: false, reason: '缺路由模块' };
  return { accept: true, reason: 'ok' };
}
