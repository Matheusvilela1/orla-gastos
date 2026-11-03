// Minhas ações: compras e vendas registradas pela pessoa. A posição de cada ativo
// é calculada pelo preço médio (como a Receita pede no Brasil) e o resultado usa a
// cotação ao vivo da aba Bolsa. Fica no arquivo de dados, dentro de "investimentos".

import { isValidId } from './finance';

export type TradeKind = 'compra' | 'venda';

export interface StockTrade {
  id: string;
  simbolo: string;
  nome: string;
  /** Moeda em que o preço foi digitado (libras, não centavos de libra). */
  moeda: string;
  tipo: TradeKind;
  qtd: number;
  /** Preço por cota. */
  preco: number;
  /** Corretagem e outros custos da operação. */
  taxas: number;
  /** AAAA-MM-DD */
  data: string;
  createdAt: string;
}

export const newTradeId = () =>
  `t-${Date.now().toString(36)}-${(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36)).replace(/-/g, '').slice(0, 10)}`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL_RE = /^[\^A-Za-z0-9.=-]{1,20}$/;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function sanitizeTrades(raw: unknown): StockTrade[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x): StockTrade[] => {
    const r = x as Record<string, unknown> | null;
    if (!r || typeof r.id !== 'string' || !isValidId(r.id) || typeof r.simbolo !== 'string' || !SYMBOL_RE.test(r.simbolo)) return [];
    const qtd = num(r.qtd);
    const preco = num(r.preco);
    if (qtd === null || qtd <= 0 || preco === null || preco < 0 || typeof r.data !== 'string' || !DATE_RE.test(r.data)) return [];
    return [
      {
        id: r.id,
        simbolo: r.simbolo,
        nome: typeof r.nome === 'string' ? r.nome.slice(0, 80) : r.simbolo,
        moeda: typeof r.moeda === 'string' && /^[A-Z]{3}$/.test(r.moeda) ? r.moeda : guessCurrency(r.simbolo),
        tipo: r.tipo === 'venda' ? 'venda' : 'compra',
        qtd,
        preco,
        taxas: Math.max(0, num(r.taxas) ?? 0),
        data: r.data,
        createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
      },
    ];
  });
}

/** Moeda provável pelo sufixo do código, para quando não há cotação (sem internet). */
export function guessCurrency(symbol: string): string {
  const fx = /^[A-Z]{3}([A-Z]{3})=X$/.exec(symbol);
  if (fx) return fx[1];
  const crypto = /-([A-Z]{3})$/.exec(symbol);
  if (crypto) return crypto[1];
  const suffix = /\.([A-Z]{1,3})$/.exec(symbol)?.[1];
  const bySuffix: Record<string, string> = { SA: 'BRL', L: 'GBP', DE: 'EUR', F: 'EUR', PA: 'EUR', AS: 'EUR', MI: 'EUR', MC: 'EUR', T: 'JPY', HK: 'HKD', TO: 'CAD', AX: 'AUD', SW: 'CHF' };
  return suffix ? (bySuffix[suffix] ?? 'USD') : 'USD';
}

/** A cotação vem em centavos de libra (GBp) na Bolsa de Londres; aqui tudo é em libras. */
export const quoteUnits = (moeda: string) => (moeda === 'GBp' || moeda === 'GBX' ? { moeda: 'GBP', fator: 0.01 } : { moeda: moeda.toUpperCase(), fator: 1 });

export interface StockPosition {
  simbolo: string;
  nome: string;
  moeda: string;
  /** Cotas que a pessoa ainda tem. */
  qtd: number;
  /** Preço médio de compra, com os custos. */
  medio: number;
  /** Quanto custaram as cotas que ainda tem (qtd × médio). */
  custo: number;
  /** Lucro ou prejuízo já realizado nas vendas. */
  realizado: number;
  trades: StockTrade[];
}

const byDate = (a: StockTrade, b: StockTrade) => a.data.localeCompare(b.data) || a.createdAt.localeCompare(b.createdAt);

/** Posição de cada ativo pelo preço médio. Vendas acima do que há são limitadas ao que há. */
export function buildPositions(trades: StockTrade[]): StockPosition[] {
  const groups = new Map<string, StockTrade[]>();
  for (const t of trades) groups.set(t.simbolo, [...(groups.get(t.simbolo) ?? []), t]);
  const out: StockPosition[] = [];
  for (const [simbolo, list] of groups) {
    const sorted = [...list].sort(byDate);
    let qtd = 0;
    let custo = 0;
    let realizado = 0;
    for (const t of sorted) {
      if (t.tipo === 'compra') {
        qtd += t.qtd;
        custo += t.qtd * t.preco + t.taxas;
      } else {
        const q = Math.min(t.qtd, qtd);
        const medio = qtd ? custo / qtd : 0;
        realizado += q * (t.preco - medio) - t.taxas;
        custo -= q * medio;
        qtd -= q;
      }
      if (qtd < 1e-9) {
        qtd = 0;
        custo = 0;
      }
    }
    const last = sorted[sorted.length - 1];
    out.push({ simbolo, nome: last.nome, moeda: last.moeda, qtd, medio: qtd ? custo / qtd : 0, custo, realizado, trades: sorted });
  }
  // Primeiro as que ainda tem, maiores primeiro; depois as já vendidas.
  return out.sort((a, b) => Number(b.qtd > 0) - Number(a.qtd > 0) || b.custo - a.custo || a.simbolo.localeCompare(b.simbolo));
}

/** Quantas cotas havia numa data, sem contar a operação `skipId` (para validar uma venda). */
export function qtyAt(trades: StockTrade[], simbolo: string, data: string, skipId?: string): number {
  const sorted = trades.filter((t) => t.simbolo === simbolo && t.id !== skipId && t.data <= data).sort(byDate);
  let q = 0;
  for (const t of sorted) q = t.tipo === 'compra' ? q + t.qtd : Math.max(0, q - t.qtd);
  return q;
}

/** Símbolo da cotação que converte a moeda para reais ("USDBRL=X"), ou null para real. */
export const fxSymbol = (moeda: string) => (moeda === 'BRL' ? null : `${moeda}BRL=X`);
