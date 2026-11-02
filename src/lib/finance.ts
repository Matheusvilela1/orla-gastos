// Finanças pessoais: lançamentos (gastos e receitas), resumo do mês,
// orçamento por categoria e dados de exemplo.
//
// Identidade que o painel inteiro respeita:
//   Saldo do mês = Receitas − Gastos

import { MONTHS } from './format';

// ---------------------------------------------------------------------------
// Tipos

/** Mês no formato AAAA-MM. */
export type MonthKey = string;

export type EntryKind = 'gasto' | 'receita';
export type ExpenseCategory = 'moradia' | 'mercado' | 'transporte' | 'lazer' | 'saude' | 'educacao' | 'assinaturas' | 'compras' | 'outros';
export type IncomeCategory = 'salario' | 'extra' | 'rendimentos' | 'outras-receitas';
export type Category = ExpenseCategory | IncomeCategory;
export type PayKind = 'pix' | 'debito' | 'cartao' | 'boleto' | 'dinheiro' | 'transferencia';
export type ExpenseStatus = 'paga' | 'atrasada' | 'vence-hoje' | 'vence-breve' | 'a-vencer';

/** Um lançamento: um gasto ou uma receita. */
export interface Expense {
  id: string;
  kind: EntryKind;
  description: string;
  category: Category;
  amount: number;
  /** Mês em que o lançamento conta no orçamento (AAAA-MM). */
  competence: MonthKey;
  /** Data ou vencimento (AAAA-MM-DD). */
  dueDate: string;
  /** Quando foi pago ou recebido (AAAA-MM-DD), ou null. */
  paidAt: string | null;
  method: PayKind;
  /** Onde foi o gasto ou de quem veio a receita. */
  supplier: string;
  notes: string;
  /** Repete todo mês (aluguel, salário, assinaturas...). */
  recurring: boolean;
  /** Liga as ocorrências de uma conta fixa ou as parcelas de uma compra. */
  seriesId: string | null;
  /** Parcela de uma compra parcelada, ex.: 3 de 10. */
  installment: { n: number; total: number } | null;
}

export type Budgets = Record<ExpenseCategory, number>;

export const CATEGORY_ORDER: ExpenseCategory[] = ['moradia', 'mercado', 'transporte', 'lazer', 'saude', 'educacao', 'assinaturas', 'compras', 'outros'];
export const INCOME_ORDER: IncomeCategory[] = ['salario', 'extra', 'rendimentos', 'outras-receitas'];
export const categoriesOf = (k: EntryKind): Category[] => (k === 'gasto' ? CATEGORY_ORDER : INCOME_ORDER);

// `color` segue a categoria, nunca a posição no ranking. "Outros" fica em cinza.
export const CATEGORIES: Record<Category, { label: string; kind: EntryKind; hint: string; color: string }> = {
  moradia: { label: 'Moradia', kind: 'gasto', hint: 'Aluguel, condomínio, luz, água, internet', color: 'var(--cat-1)' },
  mercado: { label: 'Mercado e comida', kind: 'gasto', hint: 'Supermercado, feira, delivery, restaurantes', color: 'var(--cat-2)' },
  transporte: { label: 'Transporte', kind: 'gasto', hint: 'Combustível, aplicativos, ônibus, manutenção', color: 'var(--cat-3)' },
  lazer: { label: 'Lazer', kind: 'gasto', hint: 'Passeios, cinema, bares, viagens', color: 'var(--cat-4)' },
  saude: { label: 'Saúde', kind: 'gasto', hint: 'Farmácia, consultas, academia, plano', color: 'var(--cat-5)' },
  educacao: { label: 'Educação', kind: 'gasto', hint: 'Cursos, livros, faculdade', color: 'var(--cat-6)' },
  assinaturas: { label: 'Assinaturas', kind: 'gasto', hint: 'Streaming, música, apps, celular', color: 'var(--cat-7)' },
  compras: { label: 'Compras', kind: 'gasto', hint: 'Roupas, eletrônicos, casa, presentes', color: 'var(--cat-8)' },
  outros: { label: 'Outros', kind: 'gasto', hint: 'Tarifas, impostos e o que não se encaixa', color: 'var(--cat-outros)' },
  salario: { label: 'Salário', kind: 'receita', hint: 'Salário, pró-labore, aposentadoria', color: 'var(--cat-1)' },
  extra: { label: 'Renda extra', kind: 'receita', hint: 'Freelas, bicos, vendas', color: 'var(--cat-3)' },
  rendimentos: { label: 'Rendimentos', kind: 'receita', hint: 'Juros, dividendos, aluguéis recebidos', color: 'var(--cat-7)' },
  'outras-receitas': { label: 'Outras receitas', kind: 'receita', hint: 'Reembolsos, presentes, restituição', color: 'var(--cat-outros)' },
};

export const PAY_KIND_ORDER: PayKind[] = ['pix', 'debito', 'cartao', 'boleto', 'dinheiro', 'transferencia'];

export const PAY_KINDS: Record<PayKind, string> = {
  pix: 'Pix',
  debito: 'Débito',
  cartao: 'Cartão de crédito',
  boleto: 'Boleto',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
};

// ---------------------------------------------------------------------------
// Datas e meses

const pad2 = (n: number) => String(n).padStart(2, '0');

export const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const daysBetween = (from: string, to: string) => Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86400000);

export const monthKeyOf = (d: Date): MonthKey => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

function parseMonth(key: MonthKey): [number, number] {
  const [y, m] = key.split('-').map(Number);
  return [y, m];
}

export function addMonths(key: MonthKey, n: number): MonthKey {
  const [y, m] = parseMonth(key);
  return monthKeyOf(new Date(y, m - 1 + n, 1));
}

export function daysInMonth(key: MonthKey): number {
  const [y, m] = parseMonth(key);
  return new Date(y, m, 0).getDate();
}

/** A mesma data N meses depois, com o dia ajustado ao tamanho do mês. */
export function addMonthsIso(iso: string, n: number): string {
  const key = addMonths(iso.slice(0, 7), n);
  return `${key}-${pad2(Math.min(Number(iso.slice(8, 10)), daysInMonth(key)))}`;
}

/** "outubro de 2026" */
export function monthLabel(key: MonthKey): string {
  const [y, m] = parseMonth(key);
  return `${MONTHS_LONG[m - 1]} de ${y}`;
}

/** "out" ou "jan/26" (janeiro leva o ano para marcar a virada). */
export function monthShort(key: MonthKey): string {
  const [y, m] = parseMonth(key);
  return m === 1 ? `jan/${String(y).slice(2)}` : MONTHS[m - 1];
}

/** "Outubro" */
export const monthName = (key: MonthKey) => {
  const n = MONTHS_LONG[parseMonth(key)[1] - 1];
  return n.charAt(0).toUpperCase() + n.slice(1);
};

/**
 * Até 12 meses do gráfico, terminando no mês atual ou no escolhido, o que vier depois.
 * Meses vazios do começo saem (quem começou há pouco não vê colunas zeradas), ficando pelo menos 6.
 */
export function chartMonths(current: MonthKey, selected: MonthKey, all: Expense[] = []): MonthKey[] {
  const end = selected > current ? selected : current;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(end, i - 11));
  const first = all.reduce<MonthKey | null>((min, e) => (!min || e.competence < min ? e.competence : min), null);
  const keepFrom = Math.min(6, months.findIndex((k) => first !== null && k >= first));
  return keepFrom > 0 ? months.slice(keepFrom) : months;
}

/** Meses que aparecem no seletor: os 12 do gráfico mais qualquer mês com lançamentos. */
export function navMonths(current: MonthKey, selected: MonthKey, all: Expense[]): MonthKey[] {
  const set = new Set(chartMonths(current, selected, all));
  set.add(selected);
  for (const e of all) set.add(e.competence);
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// Situação

export function expenseStatus(e: Expense, today: string): ExpenseStatus {
  if (e.paidAt) return 'paga';
  if (e.dueDate < today) return 'atrasada';
  if (e.dueDate === today) return 'vence-hoje';
  return daysBetween(today, e.dueDate) <= 3 ? 'vence-breve' : 'a-vencer';
}

export const STATUS_PRIORITY: Record<ExpenseStatus, number> = { atrasada: 0, 'vence-hoje': 1, 'vence-breve': 2, 'a-vencer': 3, paga: 4 };

// ---------------------------------------------------------------------------
// Visão do mês

export interface CategoryTotal {
  category: ExpenseCategory;
  total: number;
  paid: number;
  pending: number;
  count: number;
  budget: number;
}

export interface LedgerStats {
  count: number;
  total: number;
  paid: number;
  pending: number;
  overdue: { count: number; total: number };
  dueSoon: { count: number; total: number };
}

export interface SummaryRow {
  id: string;
  label: string;
  value: number;
  prev: number;
  kind: 'total' | 'line' | 'group';
  hint?: string;
  category?: Category;
  entryKind?: EntryKind;
  count?: number;
  children?: SummaryRow[];
}

export interface MonthFinance {
  key: MonthKey;
  label: string;
  inProgress: boolean;
  /** Receitas do mês. */
  revenue: number;
  /** Gastos do mês. */
  gastos: number;
  /** Receitas − gastos. */
  lucro: number;
  /** Parte da receita que sobrou (taxa de poupança). */
  margem: number;
  received: number;
  toReceive: number;
  expenses: Expense[];
  incomes: Expense[];
  byCategory: Record<ExpenseCategory, CategoryTotal>;
  ledger: LedgerStats;
  incomeLedger: LedgerStats;
  summary: SummaryRow[];
  prev: { revenue: number; gastos: number; lucro: number; margem: number } | null;
}

export function groupByMonth(all: Expense[]): Map<MonthKey, Expense[]> {
  const map = new Map<MonthKey, Expense[]>();
  for (const e of all) {
    const list = map.get(e.competence);
    if (list) list.push(e);
    else map.set(e.competence, [e]);
  }
  return map;
}

const sum = (l: Expense[]) => l.reduce((a, e) => a + e.amount, 0);
const isFixed = (e: Expense) => e.recurring || !!e.installment;

function ledgerStats(list: Expense[], today: string): LedgerStats {
  const s: LedgerStats = { count: 0, total: 0, paid: 0, pending: 0, overdue: { count: 0, total: 0 }, dueSoon: { count: 0, total: 0 } };
  for (const e of list) {
    s.count++;
    s.total += e.amount;
    if (e.paidAt) {
      s.paid += e.amount;
      continue;
    }
    s.pending += e.amount;
    const st = expenseStatus(e, today);
    if (st === 'atrasada') {
      s.overdue.count++;
      s.overdue.total += e.amount;
    } else if (st === 'vence-hoje' || st === 'vence-breve') {
      s.dueSoon.count++;
      s.dueSoon.total += e.amount;
    }
  }
  return s;
}

export function buildMonthFinance(key: MonthKey, all: Expense[], budgets: Budgets, today: string): MonthFinance {
  const byMonth = groupByMonth(all);
  const list = byMonth.get(key) ?? [];
  const prevList = byMonth.get(addMonths(key, -1));
  const expenses = list.filter((e) => e.kind === 'gasto');
  const incomes = list.filter((e) => e.kind === 'receita');
  const prevExpenses = prevList?.filter((e) => e.kind === 'gasto') ?? [];
  const prevIncomes = prevList?.filter((e) => e.kind === 'receita') ?? [];

  const byCategory = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, { category: c, total: 0, paid: 0, pending: 0, count: 0, budget: budgets[c] ?? 0 }]),
  ) as Record<ExpenseCategory, CategoryTotal>;
  for (const e of expenses) {
    const ct = byCategory[e.category as ExpenseCategory] ?? byCategory.outros;
    ct.total += e.amount;
    ct.count++;
    if (e.paidAt) ct.paid += e.amount;
    else ct.pending += e.amount;
  }

  const revenue = sum(incomes);
  const gastos = sum(expenses);
  const prevRevenue = sum(prevIncomes);
  const prevGastos = sum(prevExpenses);

  // Resumo: receitas, contas fixas e parcelas, gastos do dia a dia e o que sobrou.
  const rowsFor = (kind: EntryKind, cur: Expense[], prev: Expense[], sign: 1 | -1): SummaryRow[] =>
    categoriesOf(kind)
      .map((c) => {
        const a = cur.filter((e) => e.category === c);
        const b = prev.filter((e) => e.category === c);
        return { id: `${kind}-${c}`, label: CATEGORIES[c].label, value: sign * sum(a), prev: sign * sum(b), kind: 'line' as const, category: c, entryKind: kind, count: a.length };
      })
      .filter((r) => r.count || r.prev);
  const group = (id: string, label: string, kind: EntryKind, cur: Expense[], prev: Expense[], sign: 1 | -1): SummaryRow => ({
    id,
    label,
    value: sign * sum(cur),
    prev: sign * sum(prev),
    kind: 'group',
    children: rowsFor(kind, cur, prev, sign),
  });
  const summary: SummaryRow[] = [
    group('receitas', 'Receitas', 'receita', incomes, prevIncomes, 1),
    group('fixos', 'Contas fixas e parcelas', 'gasto', expenses.filter(isFixed), prevExpenses.filter(isFixed), -1),
    group('variaveis', 'Gastos do dia a dia', 'gasto', expenses.filter((e) => !isFixed(e)), prevExpenses.filter((e) => !isFixed(e)), -1),
    { id: 'lucro', label: revenue - gastos >= 0 ? 'Sobrou no mês' : 'Faltou no mês', value: revenue - gastos, prev: prevRevenue - prevGastos, kind: 'total' },
  ];

  const received = sum(incomes.filter((e) => e.paidAt));
  return {
    key,
    label: monthLabel(key),
    inProgress: monthKeyOf(parseIso(today)) === key,
    revenue,
    gastos,
    lucro: revenue - gastos,
    margem: revenue ? (revenue - gastos) / revenue : 0,
    received,
    toReceive: revenue - received,
    expenses,
    incomes,
    byCategory,
    ledger: ledgerStats(expenses, today),
    incomeLedger: ledgerStats(incomes, today),
    summary,
    prev: prevList ? { revenue: prevRevenue, gastos: prevGastos, lucro: prevRevenue - prevGastos, margem: prevRevenue ? (prevRevenue - prevGastos) / prevRevenue : 0 } : null,
  };
}

export interface TrendPoint {
  key: MonthKey;
  /** Receitas */
  revenue: number;
  gastos: number;
  /** Saldo: receitas − gastos */
  lucro: number;
  /** Parte da receita que sobrou */
  margem: number;
  inProgress: boolean;
}

export function buildTrend(months: MonthKey[], all: Expense[], current: MonthKey): TrendPoint[] {
  const byMonth = groupByMonth(all);
  return months.map((key) => {
    const l = byMonth.get(key) ?? [];
    const revenue = sum(l.filter((e) => e.kind === 'receita'));
    const gastos = sum(l.filter((e) => e.kind === 'gasto'));
    return { key, revenue, gastos, lucro: revenue - gastos, margem: revenue ? (revenue - gastos) / revenue : 0, inProgress: key === current };
  });
}

/** Lançamentos fixos do mês anterior que ainda não têm ocorrência no mês `key`. */
export function missingRecurring(all: Expense[], key: MonthKey): Expense[] {
  const prevKey = addMonths(key, -1);
  const present = new Set(all.filter((e) => e.competence === key && e.seriesId).map((e) => e.seriesId));
  return all.filter((e) => e.competence === prevKey && e.recurring && e.seriesId && !present.has(e.seriesId));
}

/** Cria a ocorrência de um lançamento fixo no mês `key`, no mesmo dia. */
export function nextOccurrence(e: Expense, key: MonthKey, id: string): Expense {
  const dueMonthOffset = e.dueDate.slice(0, 7) > e.competence ? 1 : 0;
  const dueKey = addMonths(key, dueMonthOffset);
  const day = Math.min(parseIso(e.dueDate).getDate(), daysInMonth(dueKey));
  return { ...e, id, competence: key, dueDate: `${dueKey}-${pad2(day)}`, paidAt: null, installment: null };
}

/** Divide uma compra em parcelas mensais; os centavos que sobram vão na primeira. */
export function splitInstallments(base: Expense, total: number, newId: () => string): Expense[] {
  const each = Math.floor((base.amount / total) * 100) / 100;
  const first = Math.round((base.amount - each * (total - 1)) * 100) / 100;
  const seriesId = newId();
  return Array.from({ length: total }, (_, k) => ({
    ...base,
    id: k === 0 ? base.id : newId(),
    amount: k === 0 ? first : each,
    competence: addMonths(base.competence, k),
    dueDate: addMonthsIso(base.dueDate, k),
    paidAt: k === 0 ? base.paidAt : null,
    recurring: false,
    seriesId,
    installment: { n: k + 1, total },
  }));
}

// ---------------------------------------------------------------------------
// Dados de exemplo (determinísticos, relativos à data de hoje)

export const SAMPLE_PREFIX = 'ex-';
export const isSample = (e: Expense) => e.id.startsWith(SAMPLE_PREFIX);

function rngFrom(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export const SAMPLE_BUDGETS: Budgets = {
  moradia: 2600,
  mercado: 1700,
  transporte: 650,
  lazer: 450,
  saude: 300,
  educacao: 300,
  assinaturas: 120,
  compras: 600,
  outros: 150,
};

/** Seis meses de lançamentos fictícios terminando no mês atual, mais as parcelas futuras de uma compra. */
export function generateSampleEntries(now: Date): Expense[] {
  const today = isoDate(now);
  const current = monthKeyOf(now);
  const out: Expense[] = [];

  for (let back = 5; back >= 0; back--) {
    const key = addMonths(current, -back);
    const day = (d: number) => `${key}-${pad2(Math.min(d, daysInMonth(key)))}`;
    const r = rngFrom(`exemplo:${key}`);
    const between = (a: number, b: number) => Math.round((a + r() * (b - a)) * 100) / 100;
    let n = 0;
    const add = (
      e: Pick<Expense, 'description' | 'category' | 'amount' | 'dueDate' | 'method'> & Partial<Expense>,
      opts: { series?: string; onlyPast?: boolean; overdue?: boolean } = {},
    ) => {
      if (opts.onlyPast && e.dueDate > today) return;
      const kind = CATEGORIES[e.category].kind;
      out.push({
        id: `${SAMPLE_PREFIX}${key}-${opts.series ?? n++}`,
        kind,
        competence: key,
        paidAt: !opts.overdue && e.dueDate <= today ? e.dueDate : null,
        supplier: '',
        notes: '',
        recurring: !!opts.series,
        seriesId: opts.series ? `${SAMPLE_PREFIX}${opts.series}` : null,
        installment: null,
        ...e,
      });
    };

    // Receitas
    add({ description: 'Salário', category: 'salario', amount: 6500, dueDate: day(5), method: 'transferencia', supplier: 'Empresa' }, { series: 'salario' });
    if (r() > 0.4) add({ description: 'Freela de design', category: 'extra', amount: between(600, 1800), dueDate: day(12 + Math.floor(r() * 14)), method: 'pix' }, { onlyPast: true });
    add({ description: 'Rendimento da reserva', category: 'rendimentos', amount: between(38, 66), dueDate: day(1), method: 'transferencia' }, { onlyPast: true });

    // Contas fixas
    add({ description: 'Aluguel', category: 'moradia', amount: 1800, dueDate: day(10), method: 'boleto' }, { series: 'aluguel' });
    add({ description: 'Condomínio', category: 'moradia', amount: 420, dueDate: day(10), method: 'boleto' }, { series: 'condominio' });
    add({ description: 'Conta de luz', category: 'moradia', amount: between(140, 230), dueDate: day(15), method: 'boleto' }, { series: 'luz' });
    add({ description: 'Internet', category: 'moradia', amount: 119.9, dueDate: day(20), method: 'debito' }, { series: 'internet' });
    add({ description: 'Netflix', category: 'assinaturas', amount: 55.9, dueDate: day(8), method: 'cartao' }, { series: 'netflix' });
    add({ description: 'Plano do celular', category: 'assinaturas', amount: 59.99, dueDate: day(18), method: 'debito' }, { series: 'celular' });
    if (back <= 3) add({ description: 'Curso de inglês', category: 'educacao', amount: 289, dueDate: day(7), method: 'boleto' }, { series: 'ingles' });
    // Estas ficam sem lançar no mês atual, para mostrar o aviso de contas fixas.
    if (back > 0) add({ description: 'Academia', category: 'saude', amount: 109.9, dueDate: day(6), method: 'debito' }, { series: 'academia' });
    if (back > 0) add({ description: 'Spotify', category: 'assinaturas', amount: 21.9, dueDate: day(14), method: 'cartao' }, { series: 'spotify' });

    // Dia a dia
    for (const d of [3, 10, 17, 24]) add({ description: 'Mercado', category: 'mercado', amount: between(230, 520), dueDate: day(d), method: 'debito', supplier: 'Supermercado' }, { onlyPast: true });
    for (let k = 0, t = 3 + Math.floor(r() * 4); k < t; k++)
      add({ description: 'iFood', category: 'mercado', amount: between(32, 92), dueDate: day(1 + Math.floor(r() * 28)), method: 'cartao' }, { onlyPast: true });
    for (let k = 0, t = 4 + Math.floor(r() * 5); k < t; k++)
      add({ description: 'Uber', category: 'transporte', amount: between(14, 39), dueDate: day(1 + Math.floor(r() * 28)), method: 'cartao' }, { onlyPast: true });
    for (const d of [4, 19]) add({ description: 'Gasolina', category: 'transporte', amount: between(170, 260), dueDate: day(d), method: 'cartao', supplier: 'Posto' }, { onlyPast: true });
    for (let k = 0, t = 2 + Math.floor(r() * 2); k < t; k++)
      add({ description: r() > 0.5 ? 'Cinema' : 'Bar com amigos', category: 'lazer', amount: between(55, 190), dueDate: day(1 + Math.floor(r() * 28)), method: 'cartao' }, { onlyPast: true });
    add({ description: 'Farmácia', category: 'saude', amount: between(28, 130), dueDate: day(2 + Math.floor(r() * 25)), method: 'debito' }, { onlyPast: true });
    if (r() > 0.3) add({ description: r() > 0.5 ? 'Roupas' : 'Presente de aniversário', category: 'compras', amount: between(90, 380), dueDate: day(5 + Math.floor(r() * 20)), method: 'cartao' }, { onlyPast: true });
    add({ description: 'Tarifa do banco', category: 'outros', amount: 24.9, dueDate: day(28), method: 'debito' }, { onlyPast: true });

    // Uma conta esquecida no mês passado, para mostrar o aviso de atraso.
    if (back === 1) add({ description: 'Conta de água', category: 'moradia', amount: 87.4, dueDate: day(27), method: 'boleto' }, { overdue: true });
  }

  // Compra parcelada em 10x, começando há 3 meses.
  const start = addMonths(current, -3);
  const notebook: Expense = {
    id: `${SAMPLE_PREFIX}notebook-1`,
    kind: 'gasto',
    description: 'Notebook',
    category: 'compras',
    amount: 3200,
    competence: start,
    dueDate: `${start}-12`,
    paidAt: `${start}-12`,
    method: 'cartao',
    supplier: 'Loja de eletrônicos',
    notes: '',
    recurring: false,
    seriesId: null,
    installment: null,
  };
  let k = 1;
  for (const p of splitInstallments(notebook, 10, () => `${SAMPLE_PREFIX}notebook-${++k}`)) out.push({ ...p, paidAt: p.dueDate <= today ? p.dueDate : null });

  return out;
}

/** Orçamento inicial: nenhum limite definido. */
export const DEFAULT_BUDGETS: Budgets = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Budgets;

/** Sugere limites pela média dos últimos 3 meses, arredondada para cima de R$ 50 em R$ 50. */
export function suggestBudgets(all: Expense[], month: MonthKey): Budgets {
  const out = { ...DEFAULT_BUDGETS };
  const months = [1, 2, 3].map((i) => addMonths(month, -i));
  for (const c of CATEGORY_ORDER) {
    const total = all.filter((e) => e.kind === 'gasto' && e.category === c && months.includes(e.competence)).reduce((a, e) => a + e.amount, 0);
    out[c] = Math.ceil(total / 3 / 50) * 50;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entrada de valores e saneamento de dados vindos do armazenamento

/** Lê "1.234,56", "1234,5", "1234.56" ou "R$ 1.234" e devolve o número, ou null. */
export function parseBRL(input: string): number | null {
  const s = input.replace(/[R$\s ]/g, '');
  if (!s) return null;
  let norm: string;
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length === 1 && /\.\d{1,2}$/.test(s)) norm = s;
  else norm = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(norm)) return null;
  const n = Math.round(parseFloat(norm) * 100) / 100;
  return Number.isFinite(n) ? n : null;
}

export const formatBRLInput = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,120}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export const isValidId = (id: string) => ID_RE.test(id);

/** Valida um lançamento lido do arquivo ou de um backup; descarta o que não tiver o formato esperado. */
export function sanitizeExpense(raw: unknown): Expense | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const id = str(r.id, 120);
  if (!ID_RE.test(id)) return null;
  const category = r.category && typeof r.category === 'string' && r.category in CATEGORIES ? (r.category as Category) : null;
  const amount = typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount > 0 && r.amount < 1e9 ? Math.round(r.amount * 100) / 100 : null;
  const competence = typeof r.competence === 'string' && MONTH_RE.test(r.competence) ? r.competence : null;
  const dueDate = typeof r.dueDate === 'string' && DATE_RE.test(r.dueDate) ? r.dueDate : null;
  const description = str(r.description, 120).trim();
  if (!category || amount === null || !competence || !dueDate || !description) return null;
  const paidAt = typeof r.paidAt === 'string' && DATE_RE.test(r.paidAt) ? r.paidAt : null;
  const method = PAY_KIND_ORDER.includes(r.method as PayKind) ? (r.method as PayKind) : 'pix';
  const seriesId = typeof r.seriesId === 'string' && ID_RE.test(r.seriesId) ? r.seriesId : null;
  const inst = r.installment as { n?: unknown; total?: unknown } | null | undefined;
  const installment =
    inst && Number.isInteger(inst.n) && Number.isInteger(inst.total) && (inst.n as number) >= 1 && (inst.n as number) <= (inst.total as number)
      ? { n: inst.n as number, total: inst.total as number }
      : null;
  return {
    id,
    kind: CATEGORIES[category].kind,
    description,
    category,
    amount,
    competence,
    dueDate,
    paidAt,
    method,
    supplier: str(r.supplier, 80).trim(),
    notes: str(r.notes, 280).trim(),
    recurring: r.recurring === true,
    seriesId,
    installment,
  };
}

export function sanitizeBudgets(raw: unknown): Budgets | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out = { ...DEFAULT_BUDGETS };
  for (const c of CATEGORY_ORDER) {
    const v = r[c];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9) out[c] = Math.round(v * 100) / 100;
  }
  return out;
}

export function newExpenseId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return `u-${Date.now().toString(36)}-${rand}`;
}

/** Texto do resumo do mês, para colar numa mensagem. */
export function financeSummaryText(f: MonthFinance, fmtBrl: (v: number) => string, fmtPct: (v: number) => string): string {
  const parts = [
    `Minhas finanças em ${f.label}${f.inProgress ? ' (mês em andamento)' : ''}`,
    `Receitas: ${fmtBrl(f.revenue)}`,
    `Gastos: ${fmtBrl(f.gastos)}, dos quais ${fmtBrl(f.ledger.pending)} a pagar`,
    `${f.lucro >= 0 ? 'Sobrou' : 'Faltou'}: ${fmtBrl(Math.abs(f.lucro))}${f.revenue ? ` (${fmtPct(Math.abs(f.margem))} da renda)` : ''}`,
  ];
  if (f.ledger.overdue.count) parts.push(`Em atraso: ${f.ledger.overdue.count} ${f.ledger.overdue.count === 1 ? 'conta' : 'contas'}, ${fmtBrl(f.ledger.overdue.total)}`);
  return parts.join('\n');
}

/** Lista em colunas separadas por tabulação, que cola direto em planilhas. */
export function expensesToTsv(list: Expense[], today: string, statusLabel: (s: ExpenseStatus, k: EntryKind) => string): string {
  const head = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Onde', 'Forma de pagamento', 'Situação', 'Pago em', 'Parcela', 'Valor'];
  const br = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
  const rows = list.map((e) =>
    [
      br(e.dueDate),
      e.kind === 'gasto' ? 'Gasto' : 'Receita',
      clean(e.description),
      CATEGORIES[e.category].label,
      clean(e.supplier),
      PAY_KINDS[e.method],
      statusLabel(expenseStatus(e, today), e.kind),
      e.paidAt ? br(e.paidAt) : '',
      e.installment ? `${e.installment.n}/${e.installment.total}` : '',
      (e.kind === 'gasto' ? '-' : '') + e.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ].join('\t'),
  );
  return [head.join('\t'), ...rows].join('\n');
}
