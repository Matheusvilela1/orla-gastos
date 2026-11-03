// Cotações da bolsa. É a exceção do painel: precisa de internet e do servidor local
// (veja vite.config.ts), que busca os dados públicos do Yahoo Finanças.
// Sem conexão, mostra as últimas cotações que conseguiu.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fmt } from './format';
import { storage } from './hooks';

export interface Ticker {
  simbolo: string;
  nome: string;
}

export interface Quote extends Ticker {
  bolsa: string;
  tipo: string;
  moeda: string;
  preco: number;
  anterior: number | null;
  /** Hora da última negociação (segundos desde 1970). */
  hora: number | null;
  /** Início e fim do pregão do dia (segundos). */
  abre: number | null;
  fecha: number | null;
  /** Fuso horário da bolsa, ex.: "America/Sao_Paulo". */
  fuso: string;
  /** Preço a cada 5 minutos no dia: [segundos, preço]. */
  pontos: [number, number][];
}

export interface SearchResult extends Ticker {
  bolsa: string;
  tipo: string;
}

export type ExchangeId = 'b3' | 'eua' | 'londres' | 'frankfurt' | 'toquio' | 'hongkong' | 'moedas';

export interface Exchange {
  id: ExchangeId;
  label: string;
  place: string;
  /** O que aparece em destaque (o índice principal da bolsa). */
  main: Ticker;
  tickers: Ticker[];
}

export const EXCHANGES: Exchange[] = [
  {
    id: 'b3',
    label: 'B3',
    place: 'São Paulo',
    main: { simbolo: '^BVSP', nome: 'Ibovespa' },
    tickers: [
      { simbolo: 'PETR4.SA', nome: 'Petrobras' },
      { simbolo: 'VALE3.SA', nome: 'Vale' },
      { simbolo: 'ITUB4.SA', nome: 'Itaú Unibanco' },
      { simbolo: 'BBDC4.SA', nome: 'Bradesco' },
      { simbolo: 'BBAS3.SA', nome: 'Banco do Brasil' },
      { simbolo: 'ABEV3.SA', nome: 'Ambev' },
      { simbolo: 'WEGE3.SA', nome: 'WEG' },
      { simbolo: 'MGLU3.SA', nome: 'Magazine Luiza' },
    ],
  },
  {
    id: 'eua',
    label: 'Nova York',
    place: 'NYSE e Nasdaq',
    main: { simbolo: '^GSPC', nome: 'S&P 500' },
    tickers: [
      { simbolo: 'AAPL', nome: 'Apple' },
      { simbolo: 'MSFT', nome: 'Microsoft' },
      { simbolo: 'NVDA', nome: 'Nvidia' },
      { simbolo: 'AMZN', nome: 'Amazon' },
      { simbolo: 'GOOGL', nome: 'Alphabet (Google)' },
      { simbolo: 'META', nome: 'Meta' },
      { simbolo: 'TSLA', nome: 'Tesla' },
      { simbolo: 'JPM', nome: 'JPMorgan' },
    ],
  },
  {
    id: 'londres',
    label: 'Londres',
    place: 'LSE',
    main: { simbolo: '^FTSE', nome: 'FTSE 100' },
    tickers: [
      { simbolo: 'SHEL.L', nome: 'Shell' },
      { simbolo: 'AZN.L', nome: 'AstraZeneca' },
      { simbolo: 'HSBA.L', nome: 'HSBC' },
      { simbolo: 'ULVR.L', nome: 'Unilever' },
      { simbolo: 'BP.L', nome: 'BP' },
      { simbolo: 'RIO.L', nome: 'Rio Tinto' },
    ],
  },
  {
    id: 'frankfurt',
    label: 'Frankfurt',
    place: 'Xetra',
    main: { simbolo: '^GDAXI', nome: 'DAX' },
    tickers: [
      { simbolo: 'SAP.DE', nome: 'SAP' },
      { simbolo: 'SIE.DE', nome: 'Siemens' },
      { simbolo: 'ALV.DE', nome: 'Allianz' },
      { simbolo: 'DTE.DE', nome: 'Deutsche Telekom' },
      { simbolo: 'MBG.DE', nome: 'Mercedes-Benz' },
      { simbolo: 'BMW.DE', nome: 'BMW' },
    ],
  },
  {
    id: 'toquio',
    label: 'Tóquio',
    place: 'TSE',
    main: { simbolo: '^N225', nome: 'Nikkei 225' },
    tickers: [
      { simbolo: '7203.T', nome: 'Toyota' },
      { simbolo: '6758.T', nome: 'Sony' },
      { simbolo: '7974.T', nome: 'Nintendo' },
      { simbolo: '9984.T', nome: 'SoftBank' },
      { simbolo: '8306.T', nome: 'Mitsubishi UFJ' },
      { simbolo: '6861.T', nome: 'Keyence' },
    ],
  },
  {
    id: 'hongkong',
    label: 'Hong Kong',
    place: 'HKEX',
    main: { simbolo: '^HSI', nome: 'Hang Seng' },
    tickers: [
      { simbolo: '0700.HK', nome: 'Tencent' },
      { simbolo: '9988.HK', nome: 'Alibaba' },
      { simbolo: '1810.HK', nome: 'Xiaomi' },
      { simbolo: '3690.HK', nome: 'Meituan' },
      { simbolo: '0005.HK', nome: 'HSBC' },
      { simbolo: '1299.HK', nome: 'AIA' },
    ],
  },
  {
    id: 'moedas',
    label: 'Moedas e cripto',
    place: 'Câmbio',
    main: { simbolo: 'USDBRL=X', nome: 'Dólar' },
    tickers: [
      { simbolo: 'EURBRL=X', nome: 'Euro' },
      { simbolo: 'GBPBRL=X', nome: 'Libra' },
      { simbolo: 'BTC-USD', nome: 'Bitcoin' },
      { simbolo: 'ETH-USD', nome: 'Ethereum' },
      { simbolo: 'SOL-USD', nome: 'Solana' },
    ],
  },
];

export const exchangeById = (id: ExchangeId) => EXCHANGES.find((e) => e.id === id) ?? EXCHANGES[0];

// ---------------------------------------------------------------------------
// Preferências (bolsa escolhida e as listas de cada uma), só neste navegador

export interface BolsaPrefs {
  bolsa: ExchangeId;
  /** Lista acompanhada de cada bolsa, quando a pessoa mudou a padrão. */
  listas: Partial<Record<ExchangeId, Ticker[]>>;
}

const PREFS_KEY = 'orla.bolsa';
const CACHE_KEY = 'orla.bolsa.cache';
const IDS = EXCHANGES.map((e) => e.id) as string[];

export function readPrefs(): BolsaPrefs {
  const raw = storage.get<Partial<BolsaPrefs>>(PREFS_KEY, {});
  const listas: BolsaPrefs['listas'] = {};
  for (const [id, list] of Object.entries(raw.listas ?? {})) {
    if (IDS.includes(id) && Array.isArray(list))
      listas[id as ExchangeId] = list.filter((t): t is Ticker => !!t && typeof t.simbolo === 'string' && typeof t.nome === 'string').slice(0, 30);
  }
  return { bolsa: IDS.includes(raw.bolsa as string) ? (raw.bolsa as ExchangeId) : 'b3', listas };
}

export const savePrefs = (p: BolsaPrefs) => storage.set(PREFS_KEY, p);

export const tickersOf = (prefs: BolsaPrefs, ex: Exchange) => prefs.listas[ex.id] ?? ex.tickers;

// ---------------------------------------------------------------------------
// Formatação

/** Símbolo curto para mostrar: "PETR4", "AAPL", "USD/BRL", "BTC", "BVSP". */
export function shortSymbol(s: string): string {
  const fx = /^([A-Z]{3})([A-Z]{3})=X$/.exec(s);
  if (fx) return `${fx[1]}/${fx[2]}`;
  const crypto = /^([A-Z0-9]+)-[A-Z]{3}$/.exec(s);
  if (crypto) return crypto[1];
  return s.replace(/^\^/, '').replace(/\.[A-Z]{1,3}$/, '');
}

export const isIndex = (q: Pick<Quote, 'simbolo' | 'tipo'>) => q.tipo === 'INDEX' || q.simbolo.startsWith('^');

const currencyFormats = new Map<string, Intl.NumberFormat>();

/** Preço na moeda da bolsa. Índices em pontos; libras em centavos (GBp) viram libras. */
export function formatPrice(q: Pick<Quote, 'simbolo' | 'tipo' | 'moeda'>, value: number): string {
  if (isIndex(q)) return `${fmt.dec(value, value >= 10000 ? 0 : 2)} pts`;
  let cur = q.moeda.toUpperCase();
  let v = value;
  if (q.moeda === 'GBp' || cur === 'GBX') {
    cur = 'GBP';
    v = value / 100;
  }
  // Casas da própria moeda (iene sem centavos); valores abaixo de 1 ganham 4 casas.
  const small = Math.abs(v) < 1 && v !== 0;
  const key = `${cur}:${small}`;
  let f = currencyFormats.get(key);
  if (!f) {
    const digits = small ? { minimumFractionDigits: 4, maximumFractionDigits: 4 } : {};
    try {
      f = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: cur, ...digits });
    } catch {
      f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, ...digits });
    }
    currencyFormats.set(key, f);
  }
  return f.format(v);
}

/** Variação do dia sobre o fechamento anterior (0,012 = +1,2%), ou null. */
export const changeOf = (q: Quote) => (q.anterior ? (q.preco - q.anterior) / q.anterior : null);

/** Hora no fuso da bolsa: "14:35". */
export function exchangeTime(sec: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone }).format(sec * 1000);
  } catch {
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(sec * 1000);
  }
}

/** O pregão está aberto agora? null quando a bolsa não informa. */
export function marketOpen(q: Quote, nowMs: number): boolean | null {
  if (q.tipo === 'CRYPTOCURRENCY') return true;
  if (q.abre === null || q.fecha === null) return null;
  const now = nowMs / 1000;
  return now >= q.abre && now < q.fecha;
}

// ---------------------------------------------------------------------------
// Conexão e busca

export type QuoteStatus = 'carregando' | 'ao-vivo' | 'sem-internet' | 'sem-servidor' | 'erro';

class NoServer extends Error {}
class NoInternet extends Error {}

async function getJson<T>(url: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { cache: 'no-store' });
  } catch {
    // O próprio servidor local não respondeu (painel fechado ou página estática).
    throw new NoServer();
  }
  if (r.status === 503) throw new NoInternet();
  // Página estática (ex.: GitHub Pages) devolve HTML ou 404 no lugar da API.
  if (r.status === 404 || !r.headers.get('content-type')?.includes('json')) throw new NoServer();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function searchSymbols(q: string): Promise<SearchResult[]> {
  return getJson<SearchResult[]>(`/api/cotacoes/busca?q=${encodeURIComponent(q)}`);
}

interface Cache {
  at: number;
  quotes: Record<string, Quote>;
}

const readCache = (): Cache => {
  const c = storage.get<Cache | null>(CACHE_KEY, null);
  return c && typeof c.at === 'number' && c.quotes && typeof c.quotes === 'object' ? c : { at: 0, quotes: {} };
};

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

const REFRESH_MS = 60_000;

/** Cotações dos símbolos, atualizadas a cada minuto com a aba visível. Sem internet, devolve as últimas guardadas. */
export function useQuotes(symbols: string[]) {
  const online = useOnline();
  const [cache, setCache] = useState<Cache>(readCache);
  const [status, setStatus] = useState<QuoteStatus>('carregando');
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const key = symbols.join(',');
  const run = useRef(0);

  const refresh = useCallback(async () => {
    if (!key) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('sem-internet');
      return;
    }
    const id = ++run.current;
    setBusy(true);
    try {
      const list = await getJson<(Quote | { simbolo: string; erro: true })[]>(`/api/cotacoes?simbolos=${encodeURIComponent(key)}`);
      if (id !== run.current) return;
      const ok = list.filter((x): x is Quote => !('erro' in x));
      const next: Cache = { at: Date.now(), quotes: { ...readCache().quotes } };
      for (const q of ok) next.quotes[q.simbolo] = q;
      storage.set(CACHE_KEY, next);
      setCache(next);
      setFailed(list.filter((x) => 'erro' in x).map((x) => x.simbolo));
      setStatus(ok.length || !list.length ? 'ao-vivo' : 'erro');
    } catch (e) {
      if (id !== run.current) return;
      setStatus(e instanceof NoServer ? 'sem-servidor' : e instanceof NoInternet ? 'sem-internet' : 'erro');
    } finally {
      if (id === run.current) setBusy(false);
    }
  }, [key]);

  useEffect(() => {
    if (!online) {
      setStatus('sem-internet');
      return;
    }
    refresh();
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [online, refresh]);

  return { quotes: cache.quotes, at: cache.at || null, status, failed, busy, refresh };
}
