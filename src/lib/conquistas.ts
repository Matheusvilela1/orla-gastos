// Conquistas: calculadas a partir dos lançamentos, investimentos e metas. Nada é
// gravado; quando os dados mudam, elas são recalculadas.
//
// Meses só contam depois de fechados (o mês atual ainda pode mudar).

import { addMonths, daysInMonth, groupByMonth, monthKeyOf, parseIso, type Budgets, type Expense, type MonthKey } from './finance';
import { buildPortfolio, type InvestData } from './invest';
import { goalCurrent, type Goal } from './metas';

export type AchievementGroup = 'mes' | 'investimentos' | 'metas';

export const ACHIEVEMENT_GROUPS: Record<AchievementGroup, string> = {
  mes: 'Controle do mês',
  investimentos: 'Investimentos',
  metas: 'Metas',
};

export interface Achievement {
  id: string;
  group: AchievementGroup;
  title: string;
  desc: string;
  done: boolean;
  /** Quando foi alcançada (AAAA-MM-DD), se der para saber. */
  date: string | null;
  /** 0 a 1. */
  progress: number;
  /** "2 de 3 meses", "R$ 4,2 mil de R$ 10 mil"… */
  progressText: string;
}

export interface Milestone {
  id: string;
  title: string;
  desc: string;
  date: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const monthEnd = (k: MonthKey) => `${k}-${pad2(daysInMonth(k))}`;
const brlK = (v: number) =>
  v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: v >= 100000 ? 0 : 1 })} mil` : `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
const pctText = (v: number) => `${Math.round(v * 100)}%`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

interface MonthStat {
  key: MonthKey;
  revenue: number;
  gastos: number;
  lucro: number;
  margem: number;
  list: Expense[];
}

/** Maior sequência de meses seguidos que cumprem `ok`, e a data em que cada tamanho foi alcançado. */
function streaks(months: MonthStat[], ok: (m: MonthStat) => boolean, targets: number[]) {
  let run = 0;
  let best = 0;
  let prev: MonthKey | null = null;
  const reachedAt = new Map<number, string>();
  for (const m of months) {
    const adjacent = prev !== null && addMonths(prev, 1) === m.key;
    run = ok(m) ? (adjacent && run > 0 ? run + 1 : 1) : 0;
    prev = m.key;
    best = Math.max(best, run);
    for (const t of targets) if (run >= t && !reachedAt.has(t)) reachedAt.set(t, monthEnd(m.key));
  }
  return { best, reachedAt };
}

const streakAchievement = (id: string, group: AchievementGroup, title: string, desc: string, n: number, s: ReturnType<typeof streaks>, unit: [string, string]): Achievement => ({
  id,
  group,
  title,
  desc,
  done: s.reachedAt.has(n),
  date: s.reachedAt.get(n) ?? null,
  progress: clamp01(s.best / n),
  progressText: `${Math.min(s.best, n)} de ${n} ${n === 1 ? unit[0] : unit[1]}`,
});

export function buildAchievements(expenses: Expense[], budgets: Budgets, invest: InvestData, goals: Goal[], today: string): Achievement[] {
  const current = monthKeyOf(parseIso(today));
  const byMonth = groupByMonth(expenses);
  const closed: MonthStat[] = [...byMonth.keys()]
    .filter((k) => k < current)
    .sort()
    .map((key) => {
      const list = byMonth.get(key)!;
      const revenue = list.filter((e) => e.kind === 'receita').reduce((s, e) => s + e.amount, 0);
      const gastos = list.filter((e) => e.kind === 'gasto').reduce((s, e) => s + e.amount, 0);
      return { key, revenue, gastos, lucro: revenue - gastos, margem: revenue ? (revenue - gastos) / revenue : 0, list };
    });

  const out: Achievement[] = [];

  // Controle do mês ----------------------------------------------------------
  const firstEntry = expenses.reduce<string | null>((min, e) => (!min || e.dueDate < min ? e.dueDate : min), null);
  out.push({
    id: 'primeiro-passo',
    group: 'mes',
    title: 'Primeiro passo',
    desc: 'Registrou o primeiro lançamento.',
    done: expenses.length > 0,
    date: firstEntry && firstEntry <= today ? firstEntry : expenses.length ? today : null,
    progress: expenses.length ? 1 : 0,
    progressText: expenses.length ? 'Feito' : 'Nenhum lançamento ainda',
  });

  const azul = (m: MonthStat) => m.revenue > 0 && m.lucro > 0;
  const azulStreak = streaks(closed, azul, [1, 3, 6, 12]);
  out.push(streakAchievement('no-azul', 'mes', 'No azul', 'Terminou um mês com dinheiro sobrando.', 1, azulStreak, ['mês', 'meses']));
  out.push(streakAchievement('tres-no-azul', 'mes', 'Três no azul', 'Três meses seguidos com sobra.', 3, azulStreak, ['mês', 'meses']));
  out.push(streakAchievement('semestre-no-azul', 'mes', 'Semestre no azul', 'Seis meses seguidos com sobra.', 6, azulStreak, ['mês', 'meses']));
  out.push(streakAchievement('ano-no-azul', 'mes', 'Ano no azul', 'Doze meses seguidos com sobra.', 12, azulStreak, ['mês', 'meses']));

  const bestMargin = closed.reduce((b, m) => (m.revenue > 0 ? Math.max(b, m.margem) : b), 0);
  for (const [n, title] of [
    [0.1, 'Guardou 10%'],
    [0.3, 'Guardou 30%'],
  ] as const) {
    const hit = closed.find((m) => m.revenue > 0 && m.margem >= n);
    out.push({
      id: `guardou-${Math.round(n * 100)}`,
      group: 'mes',
      title,
      desc: `Sobrou ${pctText(n)} ou mais do que entrou num mês.`,
      done: !!hit,
      date: hit ? monthEnd(hit.key) : null,
      progress: clamp01(bestMargin / n),
      progressText: closed.length ? `Melhor mês: ${pctText(Math.max(0, bestMargin))}` : 'Espere o primeiro mês fechar',
    });
  }

  // Contas em dia: um mês fechado com pelo menos 3 contas, todas pagas até o vencimento.
  const onTime = (m: MonthStat) => {
    const g = m.list.filter((e) => e.kind === 'gasto');
    return g.length ? g.filter((e) => e.paidAt && e.paidAt <= e.dueDate).length / g.length : 0;
  };
  const emDia = closed.find((m) => m.list.filter((e) => e.kind === 'gasto').length >= 3 && onTime(m) === 1);
  const bestOnTime = closed.reduce((b, m) => Math.max(b, onTime(m)), 0);
  out.push({
    id: 'contas-em-dia',
    group: 'mes',
    title: 'Contas em dia',
    desc: 'Um mês inteiro sem pagar nenhuma conta atrasada.',
    done: !!emDia,
    date: emDia ? monthEnd(emDia.key) : null,
    progress: bestOnTime,
    progressText: closed.length ? `Melhor mês: ${pctText(bestOnTime)} pagas em dia` : 'Espere o primeiro mês fechar',
  });

  const limited = (Object.keys(budgets) as (keyof Budgets)[]).filter((c) => budgets[c] > 0);
  const inBudget = (m: MonthStat) =>
    m.gastos > 0 && limited.every((c) => m.list.filter((e) => e.kind === 'gasto' && e.category === c).reduce((s, e) => s + e.amount, 0) <= budgets[c] + 0.005);
  const budgetHit = limited.length ? closed.find(inBudget) : undefined;
  out.push({
    id: 'dentro-do-orcamento',
    group: 'mes',
    title: 'Dentro do orçamento',
    desc: 'Um mês fechado sem estourar nenhum limite de categoria.',
    done: !!budgetHit,
    date: budgetHit ? monthEnd(budgetHit.key) : null,
    progress: budgetHit ? 1 : 0,
    progressText: limited.length ? (budgetHit ? 'Feito' : 'Nenhum mês fechado dentro dos limites ainda') : 'Defina limites em Meu mês',
  });

  // Investimentos -------------------------------------------------------------
  const portfolio = buildPortfolio(invest.list, today, invest.cdi);
  const moves = invest.list.flatMap((i) => i.moves).filter((m) => m.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const firstAporte = moves.find((m) => m.kind === 'aporte');
  out.push({
    id: 'primeiro-investimento',
    group: 'investimentos',
    title: 'Primeiro investimento',
    desc: 'Colocou dinheiro para render pela primeira vez.',
    done: !!firstAporte,
    date: firstAporte?.date ?? null,
    progress: firstAporte ? 1 : 0,
    progressText: firstAporte ? 'Feito' : 'Cadastre um investimento',
  });

  const crossedAt = new Map<number, string>();
  const levels = [1000, 10000, 50000, 100000];
  let net = 0;
  for (const m of moves) {
    net += m.kind === 'aporte' ? m.amount : -m.amount;
    for (const t of levels) if (net >= t && !crossedAt.has(t)) crossedAt.set(t, m.date);
  }
  const reach = Math.max(portfolio.value, portfolio.invested);
  for (const t of levels) {
    const done = crossedAt.has(t) || reach >= t;
    out.push({
      id: `investiu-${t}`,
      group: 'investimentos',
      title: `${brlK(t)} investidos`,
      desc: `A carteira chegou a ${brlK(t)}.`,
      done,
      date: crossedAt.get(t) ?? (done ? today : null),
      progress: clamp01(reach / t),
      progressText: `${brlK(Math.min(reach, t))} de ${brlK(t)}`,
    });
  }

  out.push({
    id: 'dinheiro-trabalhando',
    group: 'investimentos',
    title: 'Dinheiro trabalhando',
    desc: 'A carteira já rendeu mais do que você aplicou.',
    done: portfolio.gain > 0.005,
    date: portfolio.gain > 0.005 ? today : null,
    progress: portfolio.gain > 0.005 ? 1 : 0,
    progressText: invest.list.length ? (portfolio.gain > 0.005 ? `Rendeu ${brlK(portfolio.gain)}` : 'Ainda sem rendimento') : 'Cadastre um investimento',
  });

  const types = portfolio.byType.length;
  out.push({
    id: 'carteira-variada',
    group: 'investimentos',
    title: 'Carteira variada',
    desc: 'Dinheiro em três tipos de investimento diferentes.',
    done: types >= 3,
    date: types >= 3 ? today : null,
    progress: clamp01(types / 3),
    progressText: `${Math.min(types, 3)} de 3 tipos`,
  });

  const aporteMonths: MonthStat[] = [...new Set(moves.filter((m) => m.kind === 'aporte').map((m) => m.date.slice(0, 7)))]
    .sort()
    .map((key) => ({ key, revenue: 1, gastos: 0, lucro: 1, margem: 1, list: [] }));
  const constancy = streaks(aporteMonths, () => true, [3, 6]);
  out.push(streakAchievement('constancia', 'investimentos', 'Constância', 'Aportou em três meses seguidos.', 3, constancy, ['mês', 'meses']));
  out.push(streakAchievement('constancia-6', 'investimentos', 'Hábito formado', 'Aportou em seis meses seguidos.', 6, constancy, ['mês', 'meses']));

  // Reserva: 6 vezes a média de gastos dos últimos 3 meses fechados.
  const recent = closed.filter((m) => m.gastos > 0).slice(-3);
  const avgGastos = recent.length ? recent.reduce((s, m) => s + m.gastos, 0) / recent.length : 0;
  const reserveGoal = avgGastos * 6;
  const reserveDone = reserveGoal > 0 && portfolio.value >= reserveGoal;
  out.push({
    id: 'reserva',
    group: 'investimentos',
    title: 'Reserva de emergência',
    desc: 'Investido o bastante para seis meses dos seus gastos.',
    done: reserveDone,
    date: reserveDone ? today : null,
    progress: reserveGoal ? clamp01(portfolio.value / reserveGoal) : 0,
    progressText: reserveGoal ? `${brlK(Math.min(portfolio.value, reserveGoal))} de ${brlK(reserveGoal)}` : 'Precisa de um mês fechado com gastos',
  });

  // Metas ---------------------------------------------------------------------
  const ratios = goals.map((g) => goalCurrent(g, portfolio) / g.target);
  const doneGoals = ratios.filter((r) => r >= 1 - 1e-9).length;
  out.push({
    id: 'primeira-meta',
    group: 'metas',
    title: 'Sonho no papel',
    desc: 'Criou a primeira meta.',
    done: goals.length > 0,
    date: goals.length ? goals.map((g) => g.createdAt).filter(Boolean).sort()[0] || today : null,
    progress: goals.length ? 1 : 0,
    progressText: goals.length ? 'Feito' : 'Crie uma meta na linha do tempo',
  });
  out.push({
    id: 'meta-batida',
    group: 'metas',
    title: 'Meta batida',
    desc: 'Chegou ao valor de uma meta.',
    done: doneGoals > 0,
    date: doneGoals > 0 ? today : null,
    progress: clamp01(Math.max(0, ...ratios)),
    progressText: goals.length ? `Mais perto: ${pctText(clamp01(Math.max(0, ...ratios)))}` : 'Nenhuma meta ainda',
  });
  out.push({
    id: 'tres-metas',
    group: 'metas',
    title: 'Colecionador de metas',
    desc: 'Bateu três metas.',
    done: doneGoals >= 3,
    date: doneGoals >= 3 ? today : null,
    progress: clamp01(doneGoals / 3),
    progressText: `${Math.min(doneGoals, 3)} de 3 metas`,
  });

  return out;
}

/** Datas importantes para a linha do tempo. */
export function buildMilestones(expenses: Expense[], invest: InvestData, today: string): Milestone[] {
  const out: Milestone[] = [];
  const past = expenses.filter((e) => e.dueDate <= today);
  const first = past.reduce<Expense | null>((min, e) => (!min || e.dueDate < min.dueDate ? e : min), null);
  if (first) out.push({ id: 'marco-inicio', title: 'Começou a controlar', desc: `Primeiro lançamento: “${first.description}”.`, date: first.dueDate });
  const salary = past.filter((e) => e.kind === 'receita').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (salary) out.push({ id: 'marco-receita', title: 'Primeira receita registrada', desc: `“${salary.description}”.`, date: salary.dueDate });
  for (const inv of invest.list) {
    const firstMove = [...inv.moves].filter((m) => m.date <= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (firstMove) out.push({ id: `marco-${inv.id}`, title: `Abriu “${inv.name}”`, desc: 'Primeiro aporte neste investimento.', date: firstMove.date });
  }
  return out;
}
