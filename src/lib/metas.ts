// Metas: um valor a alcançar, com ou sem prazo. O progresso vem da carteira
// inteira, de um investimento ou de um valor que a pessoa atualiza à mão.

import { isValidId } from './finance';
import { newInvestId, type Portfolio } from './invest';

export type GoalSource = 'carteira' | 'investimento' | 'manual';

export const GOAL_SOURCES: Record<GoalSource, string> = {
  carteira: 'Toda a carteira',
  investimento: 'Um investimento',
  manual: 'Eu atualizo',
};

export interface Goal {
  id: string;
  name: string;
  target: number;
  /** Prazo (AAAA-MM-DD), ou null para sem prazo. */
  deadline: string | null;
  source: GoalSource;
  /** Quando `source` é "investimento". */
  investmentId: string | null;
  /** Quanto já foi guardado, quando `source` é "manual". */
  saved: number;
  createdAt: string;
}

export const newGoalId = () => newInvestId('g');

/** Quanto a meta já tem. */
export function goalCurrent(g: Goal, portfolio: Portfolio): number {
  if (g.source === 'carteira') return portfolio.value;
  if (g.source === 'investimento') return (g.investmentId && portfolio.positions.get(g.investmentId)?.value) || 0;
  return g.saved;
}

export const goalDone = (g: Goal, portfolio: Portfolio) => goalCurrent(g, portfolio) >= g.target - 0.005;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES = Object.keys(GOAL_SOURCES) as GoalSource[];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Valida as metas lidas do arquivo ou de um backup. */
export function sanitizeGoals(raw: unknown): Goal[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x): Goal[] => {
    const r = x as Record<string, unknown> | null;
    const target = num(r?.target);
    if (!r || typeof r.id !== 'string' || !isValidId(r.id) || typeof r.name !== 'string' || target === null || target <= 0) return [];
    const source = SOURCES.includes(r.source as GoalSource) ? (r.source as GoalSource) : 'manual';
    return [
      {
        id: r.id,
        name: r.name.slice(0, 80),
        target,
        deadline: typeof r.deadline === 'string' && DATE_RE.test(r.deadline) ? r.deadline : null,
        source,
        investmentId: source === 'investimento' && typeof r.investmentId === 'string' ? r.investmentId : null,
        saved: Math.max(0, num(r.saved) ?? 0),
        createdAt: typeof r.createdAt === 'string' && DATE_RE.test(r.createdAt) ? r.createdAt : '',
      },
    ];
  });
}
