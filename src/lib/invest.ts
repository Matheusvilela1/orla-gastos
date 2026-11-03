// Investimentos: o que você aplicou, quanto vale hoje e quanto rendeu.
//
// Cada investimento guarda os aportes e resgates. O valor de hoje vem do último
// valor que você conferiu no banco (se tiver) e, depois dele, da rentabilidade
// informada, com juros compostos por dia corrido. Tudo antes do imposto de renda.

import { addDays, addMonths, isoDate, isValidId, monthKeyOf, parseIso, SAMPLE_PREFIX, type MonthKey } from './finance';
import { sanitizeTrades, type StockTrade } from './acoes';

export type InvestType = 'tesouro' | 'cdb' | 'poupanca' | 'acoes' | 'fiis' | 'cripto' | 'previdencia' | 'outros';

export const INVEST_TYPES: Record<InvestType, { label: string; hint: string; color: string }> = {
  tesouro: { label: 'Tesouro Direto', hint: 'Selic, IPCA+, Prefixado', color: 'var(--cat-1)' },
  cdb: { label: 'CDB, LCI e LCA', hint: 'Renda fixa de bancos', color: 'var(--cat-2)' },
  poupanca: { label: 'Poupança', hint: 'Conta poupança', color: 'var(--cat-3)' },
  acoes: { label: 'Ações e ETFs', hint: 'Bolsa de valores', color: 'var(--cat-4)' },
  fiis: { label: 'Fundos imobiliários', hint: 'FIIs', color: 'var(--cat-5)' },
  cripto: { label: 'Criptomoedas', hint: 'Bitcoin e outras', color: 'var(--cat-6)' },
  previdencia: { label: 'Previdência', hint: 'PGBL, VGBL', color: 'var(--cat-7)' },
  outros: { label: 'Outros', hint: 'Fundos, caixinhas, reserva', color: 'var(--cat-outros)' },
};

export const INVEST_ORDER: InvestType[] = ['tesouro', 'cdb', 'poupanca', 'acoes', 'fiis', 'cripto', 'previdencia', 'outros'];

/** Como a rentabilidade foi informada: % do CDI, % ao ano, % ao mês ou sem taxa (renda variável). */
export type RateKind = 'cdi' | 'ano' | 'mes' | 'nenhuma';

export const RATE_KINDS: Record<RateKind, string> = {
  cdi: '% do CDI',
  ano: '% ao ano',
  mes: '% ao mês',
  nenhuma: 'Sem taxa fixa',
};

export interface InvestMove {
  id: string;
  date: string;
  kind: 'aporte' | 'resgate';
  amount: number;
}

export interface Investment {
  id: string;
  name: string;
  type: InvestType;
  institution: string;
  rateKind: RateKind;
  /** 110 para "110% do CDI", 12 para "12% ao ano". */
  rate: number;
  moves: InvestMove[];
  /**
   * Último valor conferido no banco ou na corretora. `seen` guarda os aportes e
   * resgates que já existiam quando o valor foi conferido (já estão dentro dele).
   */
  current: { value: number; date: string; seen?: string[] } | null;
  notes: string;
}

export interface InvestData {
  list: Investment[];
  /** CDI usado nas contas, em % ao ano. */
  cdi: number;
  /** Compras e vendas de ações (aba Bolsa). */
  trades: StockTrade[];
}

/** CDI de referência para começar; dá para trocar na tela de investimentos. */
export const DEFAULT_CDI = 14.9;

export const EMPTY_INVEST: InvestData = { list: [], cdi: DEFAULT_CDI, trades: [] };

// ---------------------------------------------------------------------------
// Taxas

/** Taxa anual efetiva (0,12 = 12% ao ano). */
export function annualRate(inv: Pick<Investment, 'rateKind' | 'rate'>, cdi: number): number {
  switch (inv.rateKind) {
    case 'cdi':
      return ((cdi / 100) * inv.rate) / 100;
    case 'ano':
      return inv.rate / 100;
    case 'mes':
      return (1 + inv.rate / 100) ** 12 - 1;
    default:
      return 0;
  }
}

export const monthlyFromAnnual = (a: number) => (1 + a) ** (1 / 12) - 1;

const grow = (value: number, annual: number, days: number) => (days > 0 && annual ? value * (1 + annual) ** (days / 365) : value);

const daysFrom = (a: string, b: string) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86400000);

export function rateText(inv: Pick<Investment, 'rateKind' | 'rate'>): string {
  if (inv.rateKind === 'nenhuma' || !inv.rate) return 'Sem taxa fixa';
  return `${inv.rate.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${RATE_KINDS[inv.rateKind]}`;
}

// ---------------------------------------------------------------------------
// Posição de cada investimento

export interface Position {
  /** Aportes menos resgates. */
  invested: number;
  aportes: number;
  resgates: number;
  /** Quanto vale hoje (estimado ou conferido). */
  value: number;
  /** Rendimento em reais e em % do que está aplicado. */
  gain: number;
  gainPct: number | null;
  /** O valor de hoje foi calculado pela taxa, e não conferido no banco hoje. */
  estimated: boolean;
  firstDate: string | null;
}

export function positionOf(inv: Investment, today: string, cdi: number): Position {
  const annual = annualRate(inv, cdi);
  const moves = [...inv.moves].filter((m) => m.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const aportes = moves.filter((m) => m.kind === 'aporte').reduce((s, m) => s + m.amount, 0);
  const resgates = moves.filter((m) => m.kind === 'resgate').reduce((s, m) => s + m.amount, 0);
  const invested = aportes - resgates;

  // A partir do último valor conferido (ou do zero), soma o que entrou/saiu depois e faz render até hoje.
  const base = inv.current && inv.current.date <= today ? inv.current : null;
  let value = base ? grow(base.value, annual, daysFrom(base.date, today)) : 0;
  const seen = base?.seen ? new Set(base.seen) : null;
  for (const m of moves) {
    // Já está dentro do valor conferido: o que existia na hora, ou o que tem data anterior a ele.
    if (base && (seen ? seen.has(m.id) || m.date < base.date : m.date <= base.date)) continue;
    const v = grow(m.amount, annual, daysFrom(m.date, today));
    value += m.kind === 'aporte' ? v : -v;
  }
  value = Math.max(0, value);
  const gain = value - invested;
  const estimated = base ? base.date < today && annual > 0 : annual > 0;
  return {
    invested,
    aportes,
    resgates,
    value,
    gain,
    gainPct: invested > 0.005 ? gain / invested : null,
    estimated,
    firstDate: moves[0]?.date ?? null,
  };
}

export interface Portfolio {
  invested: number;
  value: number;
  gain: number;
  gainPct: number | null;
  estimated: boolean;
  byType: { type: InvestType; value: number; share: number }[];
  positions: Map<string, Position>;
}

export function buildPortfolio(list: Investment[], today: string, cdi: number): Portfolio {
  const positions = new Map(list.map((inv) => [inv.id, positionOf(inv, today, cdi)] as const));
  let invested = 0;
  let value = 0;
  let estimated = false;
  const totals = new Map<InvestType, number>();
  for (const inv of list) {
    const p = positions.get(inv.id)!;
    invested += p.invested;
    value += p.value;
    estimated ||= p.estimated;
    totals.set(inv.type, (totals.get(inv.type) ?? 0) + p.value);
  }
  const byType = INVEST_ORDER.filter((t) => (totals.get(t) ?? 0) > 0.005).map((t) => ({ type: t, value: totals.get(t)!, share: value ? totals.get(t)! / value : 0 }));
  const gain = value - invested;
  return { invested, value, gain, gainPct: invested > 0.005 ? gain / invested : null, estimated, byType, positions };
}

/** Aportes e resgates de um mês (usado em "Meu mês"). */
export function monthMoves(list: Investment[], month: MonthKey) {
  let aportes = 0;
  let resgates = 0;
  for (const inv of list)
    for (const m of inv.moves) {
      if (m.date.slice(0, 7) !== month) continue;
      if (m.kind === 'aporte') aportes += m.amount;
      else resgates += m.amount;
    }
  return { aportes, resgates };
}

/** Aportes por mês dos últimos `n` meses, terminando em `current`. */
export function aportesByMonth(list: Investment[], current: MonthKey, n = 12) {
  const months = Array.from({ length: n }, (_, i) => addMonths(current, i - n + 1));
  return months.map((key) => ({ key, ...monthMoves(list, key) }));
}

// ---------------------------------------------------------------------------
// Simulador (juros compostos com aporte mensal)

export interface SimInput {
  initial: number;
  monthly: number;
  /** Taxa ao mês (0,01 = 1% ao mês). */
  monthlyRate: number;
  months: number;
}

export interface SimPoint {
  month: number;
  invested: number;
  total: number;
}

/** O aporte do mês entra no fim do mês, depois de render o que já estava aplicado. */
export function simulate({ initial, monthly, monthlyRate, months }: SimInput): SimPoint[] {
  const out: SimPoint[] = [{ month: 0, invested: initial, total: initial }];
  let total = initial;
  let invested = initial;
  for (let m = 1; m <= months; m++) {
    total = total * (1 + monthlyRate) + monthly;
    invested += monthly;
    out.push({ month: m, invested, total });
  }
  return out;
}

/** Quanto aportar por mês para chegar em `goal` (com o valor inicial e a taxa dados). */
export function monthlyForGoal(goal: number, initial: number, monthlyRate: number, months: number): number {
  if (months <= 0) return Math.max(0, goal - initial);
  const grown = initial * (1 + monthlyRate) ** months;
  const factor = monthlyRate ? ((1 + monthlyRate) ** months - 1) / monthlyRate : months;
  return Math.max(0, (goal - grown) / factor);
}

// ---------------------------------------------------------------------------
// Arquivo e exemplos

export const newInvestId = (prefix = 'i') =>
  `${prefix}-${Date.now().toString(36)}-${(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36)).replace(/-/g, '').slice(0, 10)}`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Valida um investimento lido do arquivo ou de um backup. */
export function sanitizeInvestment(raw: unknown): Investment | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !isValidId(r.id) || typeof r.name !== 'string') return null;
  const type = (INVEST_ORDER as string[]).includes(r.type as string) ? (r.type as InvestType) : 'outros';
  const rateKind = (Object.keys(RATE_KINDS) as string[]).includes(r.rateKind as string) ? (r.rateKind as RateKind) : 'nenhuma';
  const moves = Array.isArray(r.moves)
    ? r.moves.flatMap((m): InvestMove[] => {
        const x = m as Record<string, unknown>;
        const amount = num(x?.amount);
        if (!x || typeof x.id !== 'string' || !DATE_RE.test(String(x.date)) || amount === null || amount <= 0) return [];
        return [{ id: x.id, date: String(x.date), kind: x.kind === 'resgate' ? 'resgate' : 'aporte', amount }];
      })
    : [];
  const c = r.current as Record<string, unknown> | null;
  const cv = num(c?.value);
  return {
    id: r.id,
    name: r.name.slice(0, 80),
    type,
    institution: str(r.institution, 60),
    rateKind,
    rate: Math.max(0, num(r.rate) ?? 0),
    moves,
    current:
      c && cv !== null && cv >= 0 && DATE_RE.test(String(c.date))
        ? { value: cv, date: String(c.date), ...(Array.isArray(c.seen) ? { seen: c.seen.filter((s): s is string => typeof s === 'string').slice(0, 2000) } : {}) }
        : null,
    notes: str(r.notes, 280),
  };
}

export function sanitizeInvestData(raw: unknown): InvestData {
  if (!raw || typeof raw !== 'object') return EMPTY_INVEST;
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.lista) ? r.lista.flatMap((x) => sanitizeInvestment(x) ?? []) : [];
  const cdi = num(r.cdi);
  return { list, cdi: cdi !== null && cdi > 0 && cdi < 100 ? cdi : DEFAULT_CDI, trades: sanitizeTrades(r.operacoes) };
}

/** Formato gravado no arquivo (chaves em português, como o resto do arquivo). */
export const investDataToFile = (d: InvestData) => ({ lista: d.list, cdi: d.cdi, operacoes: d.trades });

export const isSampleInvestment = (inv: Investment) => inv.id.startsWith(SAMPLE_PREFIX);

export function generateSampleInvestments(now: Date): Investment[] {
  const today = isoDate(now);
  const monthsAgo = (n: number, day = 5) => {
    const k = addMonths(monthKeyOf(now), -n);
    const d = `${k}-${String(day).padStart(2, '0')}`;
    return d > today ? today : d;
  };
  const monthly = (id: string, n: number, amount: number, day: number): InvestMove[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${SAMPLE_PREFIX}${id}-${i}`, date: monthsAgo(n - 1 - i, day), kind: 'aporte' as const, amount }));
  return [
    {
      id: `${SAMPLE_PREFIX}inv-reserva`,
      name: 'Reserva de emergência',
      type: 'cdb',
      institution: 'Banco digital',
      rateKind: 'cdi',
      rate: 100,
      moves: [{ id: `${SAMPLE_PREFIX}res-0`, date: monthsAgo(8, 2), kind: 'aporte', amount: 5000 }, ...monthly('res', 6, 400, 6)],
      current: null,
      notes: 'Liquidez diária',
    },
    {
      id: `${SAMPLE_PREFIX}inv-selic`,
      name: 'Tesouro Selic 2029',
      type: 'tesouro',
      institution: 'Corretora',
      rateKind: 'cdi',
      rate: 100,
      moves: monthly('selic', 5, 300, 10),
      current: null,
      notes: '',
    },
    {
      id: `${SAMPLE_PREFIX}inv-etf`,
      name: 'ETF de ações (IVVB11)',
      type: 'acoes',
      institution: 'Corretora',
      rateKind: 'nenhuma',
      rate: 0,
      moves: [
        { id: `${SAMPLE_PREFIX}etf-0`, date: monthsAgo(6, 12), kind: 'aporte', amount: 1500 },
        { id: `${SAMPLE_PREFIX}etf-1`, date: monthsAgo(3, 12), kind: 'aporte', amount: 1000 },
      ],
      current: { value: 2730.4, date: isoDate(addDays(now, -2)) },
      notes: '',
    },
  ];
}
