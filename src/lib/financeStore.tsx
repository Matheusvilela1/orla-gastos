// Armazenamento dos lançamentos.
//
// Onde os dados ficam:
//  - "arquivo": em dados/orla-financas.json, dentro da pasta do projeto, gravado
//    pelo servidor local do Vite (veja vite.config.ts). Nada sai do computador;
//  - "local": no localStorage deste navegador, quando o servidor não responde
//    (e sempre na versão de demonstração, que começa com os dados de exemplo).
// O navegador sempre guarda uma cópia também, por segurança.
// Para ligar a um backend próprio, implemente a interface Backend abaixo.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '../components/toast';
import { DEFAULT_BUDGETS, SAMPLE_BUDGETS, addMonths, generateSampleEntries, isValidId, monthKeyOf, sanitizeBudgets, sanitizeExpense, type Budgets, type Expense } from './finance';
import { EMPTY_INVEST, generateSampleInvestments, investDataToFile, sanitizeInvestData, type InvestData } from './invest';
import { newGoalId, sanitizeGoals, type Goal } from './metas';

/** Versão de demonstração (npm run build:demo): sem servidor, começa com os dados de exemplo. */
export const IS_DEMO = import.meta.env.MODE === 'demo';

export type Override = { kind: 'upsert'; expense: Expense } | { kind: 'remove' };
export type Overrides = Record<string, Override>;
/** Alterações a aplicar: um Override por id, ou null para apagar. */
export type Changes = Record<string, Override | null>;
export type StorageMode = 'iniciando' | 'arquivo' | 'local';
export type SyncState = 'ok' | 'salvando' | 'erro';

interface BackendData {
  overrides: Overrides;
  budgets: Budgets | null;
  invest: InvestData;
  goals: Goal[];
}

export interface Backend {
  mode: 'arquivo' | 'local';
  start(onData: (d: BackendData) => void, onFatal: (code: string) => void): void;
  write(changes: Changes): Promise<void>;
  writeBudgets(b: Budgets | null): Promise<void>;
  writeInvest(d: InvestData): Promise<void>;
  writeGoals(g: Goal[]): Promise<void>;
  reset(): Promise<void>;
  stop(): void;
}

function applyChanges(base: Overrides, changes: Changes): Overrides {
  const out = { ...base };
  for (const [id, ov] of Object.entries(changes)) {
    if (ov) out[id] = ov;
    else delete out[id];
  }
  return out;
}

const listOf = (o: Overrides): Expense[] => Object.values(o).flatMap((ov) => (ov.kind === 'upsert' ? [ov.expense] : []));

/** Formato do arquivo de dados e dos backups. */
export interface SavedFile {
  versao: 1;
  lancamentos: Expense[];
  orcamentos: Budgets | null;
  investimentos?: ReturnType<typeof investDataToFile>;
  metas?: Goal[];
  atualizadoEm: string;
}

const toFile = (s: BackendData): SavedFile => ({
  versao: 1,
  lancamentos: listOf(s.overrides).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
  orcamentos: s.budgets,
  investimentos: investDataToFile(s.invest),
  metas: s.goals,
  atualizadoEm: new Date().toISOString(),
});

/** Lê um arquivo de dados ou de backup. Devolve null se não tiver o formato certo. */
export function parseSavedFile(raw: unknown): (BackendData & { atualizadoEm: string }) | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as SavedFile).lancamentos)) return null;
  const f = raw as SavedFile;
  const overrides: Overrides = {};
  for (const item of f.lancamentos) {
    const e = sanitizeExpense(item);
    if (e && isValidId(e.id)) overrides[e.id] = { kind: 'upsert', expense: e };
  }
  return {
    overrides,
    budgets: f.orcamentos ? sanitizeBudgets(f.orcamentos) : null,
    invest: sanitizeInvestData(f.investimentos),
    goals: sanitizeGoals(f.metas),
    atualizadoEm: typeof f.atualizadoEm === 'string' ? f.atualizadoEm : '' };
}

export const savedFileText = (expenses: Expense[], budgets: Budgets | null, invest: InvestData, goals: Goal[]) =>
  JSON.stringify(toFile({ overrides: Object.fromEntries(expenses.map((e) => [e.id, { kind: 'upsert', expense: e } as Override])), budgets, invest, goals }), null, 2);

// ---------------------------------------------------------------------------
// Neste navegador (localStorage)

const LOCAL_KEY = 'orla.financas.v1';

function readLocal(key = LOCAL_KEY): (BackendData & { atualizadoEm: string }) | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? parseSavedFile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(state: BackendData, key = LOCAL_KEY) {
  try {
    window.localStorage.setItem(key, JSON.stringify(toFile(state)));
  } catch {
    /* sem armazenamento: as alterações valem só nesta visita */
  }
}

const EMPTY: BackendData = { overrides: {}, budgets: null, invest: EMPTY_INVEST, goals: [] };

export function createLocalBackend(key = LOCAL_KEY, initial: () => BackendData = () => EMPTY): Backend {
  let state: BackendData = readLocal(key) ?? initial();
  let emit: ((d: BackendData) => void) | null = null;
  const push = () => emit?.(state);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== key) return;
    state = readLocal(key) ?? EMPTY;
    push();
  };
  return {
    mode: 'local',
    start(onData) {
      emit = onData;
      push();
      window.addEventListener('storage', onStorage);
    },
    async write(changes) {
      state = { ...state, overrides: applyChanges(state.overrides, changes) };
      writeLocal(state, key);
      push();
    },
    async writeBudgets(b) {
      state = { ...state, budgets: b };
      writeLocal(state, key);
      push();
    },
    async writeInvest(d) {
      state = { ...state, invest: d };
      writeLocal(state, key);
      push();
    },
    async writeGoals(g) {
      state = { ...state, goals: g };
      writeLocal(state, key);
      push();
    },
    async reset() {
      state = EMPTY;
      writeLocal(state, key);
      push();
    },
    stop() {
      window.removeEventListener('storage', onStorage);
      emit = null;
    },
  };
}

/** Seis meses de exemplo, os investimentos de exemplo e uma meta, para a demonstração. */
function demoData(): BackendData {
  const now = new Date();
  const goal: Goal = {
    id: newGoalId(),
    name: 'Reserva de emergência',
    target: 20000,
    deadline: `${addMonths(monthKeyOf(now), 12)}-01`,
    source: 'carteira',
    investmentId: null,
    saved: 0,
    createdAt: now.toISOString(),
  };
  return {
    overrides: Object.fromEntries(generateSampleEntries(now).map((e) => [e.id, { kind: 'upsert', expense: e } as Override])),
    budgets: SAMPLE_BUDGETS,
    invest: { ...EMPTY_INVEST, list: generateSampleInvestments(now) },
    goals: [goal],
  };
}

// Chave própria: a demonstração nunca mistura com os dados de verdade.
export const createDemoBackend = () => createLocalBackend('orla.demo.v1', demoData);

// ---------------------------------------------------------------------------
// Arquivo no PC (servidor local do Vite)

const API = '/api/dados';

export function createFileBackend(): Backend {
  let state: BackendData = EMPTY;
  let emit: ((d: BackendData) => void) | null = null;
  // Uma gravação por vez, sempre com o estado mais recente.
  let queue: Promise<void> = Promise.resolve();
  const persist = () => {
    writeLocal(state);
    const body = JSON.stringify(toFile(state), null, 2);
    const p = queue.then(async () => {
      const r = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    });
    queue = p.catch(() => undefined);
    return p;
  };

  return {
    mode: 'arquivo',
    start(onData, onFatal) {
      emit = onData;
      fetch(API, { cache: 'no-store' })
        .then(async (r) => {
          if (!r.ok || !r.headers.get('content-type')?.includes('json')) throw new Error('sem servidor');
          const fromFile = parseSavedFile(await r.json());
          // Se o navegador tiver uma cópia mais nova (ex.: a janela fechou antes de gravar), fica com ela.
          const local = readLocal();
          const newest = local && (!fromFile || local.atualizadoEm > fromFile.atualizadoEm) ? local : fromFile;
          state = newest ? { overrides: newest.overrides, budgets: newest.budgets, invest: newest.invest, goals: newest.goals } : EMPTY;
          emit?.(state);
          if (newest && newest === local && fromFile !== local) persist().catch(() => undefined);
        })
        .catch(() => onFatal('unavailable'));
    },
    write(changes) {
      state = { ...state, overrides: applyChanges(state.overrides, changes) };
      emit?.(state);
      return persist();
    },
    writeBudgets(b) {
      state = { ...state, budgets: b };
      emit?.(state);
      return persist();
    },
    writeInvest(d) {
      state = { ...state, invest: d };
      emit?.(state);
      return persist();
    },
    writeGoals(g) {
      state = { ...state, goals: g };
      emit?.(state);
      return persist();
    },
    reset() {
      state = EMPTY;
      emit?.(state);
      return persist();
    },
    stop() {
      emit = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Contexto React

interface FinanceContextValue {
  mode: StorageMode;
  sync: SyncState;
  /** Os dados salvos já chegaram. */
  ready: boolean;
  /** Todos os lançamentos, de todos os meses. */
  expenses: Expense[];
  budgets: Budgets;
  /** Há algum lançamento ou orçamento salvo. */
  hasChanges: boolean;
  /** Salva (cria ou atualiza) e devolve as alterações que desfazem a operação. */
  save: (list: Expense[]) => Changes;
  remove: (ids: string[]) => Changes;
  apply: (changes: Changes) => void;
  saveBudgets: (b: Budgets | null) => Budgets | null;
  /** Investimentos e o CDI usado nas contas. */
  invest: InvestData;
  /** Grava os investimentos e devolve o estado anterior (para desfazer). */
  saveInvest: (d: InvestData) => InvestData;
  /** Metas da linha do tempo. */
  goals: Goal[];
  /** Grava as metas e devolve as anteriores (para desfazer). */
  saveGoals: (g: Goal[]) => Goal[];
  /** Troca tudo pelo conteúdo de um backup. */
  replaceAll: (list: Expense[], budgets: Budgets | null, invest: InvestData, goals: Goal[]) => void;
  clearAll: () => Promise<void>;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function useFinance(): FinanceContextValue {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinance precisa estar dentro de <FinanceProvider>');
  return ctx;
}

export function FinanceProvider({
  children,
  createBackend = createFileBackend,
}: {
  children: ReactNode;
  /** Armazenamento próprio (ex.: uma API). Passe uma função estável. */
  createBackend?: () => Backend;
}) {
  const toast = useToast();
  const [overrides, setOverrides] = useState<Overrides>({});
  const [storedBudgets, setStoredBudgets] = useState<Budgets | null>(null);
  const [invest, setInvest] = useState<InvestData>(EMPTY_INVEST);
  const investRef = useRef<InvestData>(EMPTY_INVEST);
  const [goals, setGoals] = useState<Goal[]>([]);
  const goalsRef = useRef<Goal[]>([]);
  const [mode, setMode] = useState<StorageMode>('iniciando');
  const [sync, setSync] = useState<SyncState>('ok');
  const [ready, setReady] = useState(false);

  const backend = useRef<Backend | null>(null);
  const overridesRef = useRef<Overrides>({});
  const budgetsRef = useRef<Budgets | null>(null);
  const inflight = useRef(0);

  const track = useCallback(
    (p: Promise<void>, failMessage: string) => {
      inflight.current++;
      setSync('salvando');
      p.then(() => setSync(inflight.current > 1 ? 'salvando' : 'ok'))
        .catch(() => {
          setSync('erro');
          toast(failMessage, 'error');
        })
        .finally(() => {
          inflight.current--;
        });
    },
    [toast],
  );

  const start = useCallback(
    (b: Backend) => {
      backend.current?.stop();
      backend.current = b;
      setMode(b.mode);
      b.start(
        (d) => {
          overridesRef.current = d.overrides;
          budgetsRef.current = d.budgets;
          investRef.current = d.invest;
          goalsRef.current = d.goals;
          setOverrides(d.overrides);
          setStoredBudgets(d.budgets);
          setInvest(d.invest);
          setGoals(d.goals);
          setReady(true);
        },
        () => {
          if (backend.current !== b) return;
          toast('Não foi possível abrir o arquivo de dados. Por enquanto, tudo fica salvo neste navegador.', 'info');
          start(createLocalBackend());
        },
      );
    },
    [toast],
  );

  useEffect(() => {
    start(createBackend());
    return () => {
      backend.current?.stop();
      backend.current = null;
    };
  }, [start, createBackend]);

  const commit = useCallback(
    (changes: Changes) => {
      if (!Object.keys(changes).length || !backend.current) return;
      track(backend.current.write(changes), 'Não foi possível salvar no arquivo. A cópia do navegador foi mantida; tente de novo.');
    },
    [track],
  );

  const undoFor = (ids: string[]): Changes => Object.fromEntries(ids.map((id) => [id, overridesRef.current[id] ?? null]));

  const save = useCallback(
    (list: Expense[]) => {
      const undo = undoFor(list.map((e) => e.id));
      commit(Object.fromEntries(list.map((e) => [e.id, { kind: 'upsert', expense: e } as Override])));
      return undo;
    },
    [commit],
  );

  const remove = useCallback(
    (ids: string[]) => {
      const undo = undoFor(ids);
      commit(Object.fromEntries(ids.map((id) => [id, null])));
      return undo;
    },
    [commit],
  );

  const saveBudgets = useCallback(
    (b: Budgets | null) => {
      const previous = budgetsRef.current;
      if (backend.current) track(backend.current.writeBudgets(b), 'Não foi possível salvar os orçamentos. Tente de novo.');
      return previous;
    },
    [track],
  );

  const saveInvest = useCallback(
    (d: InvestData) => {
      const previous = investRef.current;
      if (backend.current) track(backend.current.writeInvest(d), 'Não foi possível salvar os investimentos. Tente de novo.');
      return previous;
    },
    [track],
  );

  const saveGoals = useCallback(
    (g: Goal[]) => {
      const previous = goalsRef.current;
      if (backend.current) track(backend.current.writeGoals(g), 'Não foi possível salvar as metas. Tente de novo.');
      return previous;
    },
    [track],
  );

  const replaceAll = useCallback(
    (list: Expense[], budgets: Budgets | null, inv: InvestData, g: Goal[]) => {
      const changes: Changes = Object.fromEntries(Object.keys(overridesRef.current).map((id) => [id, null]));
      for (const e of list) changes[e.id] = { kind: 'upsert', expense: e };
      commit(changes);
      saveBudgets(budgets);
      saveInvest(inv);
      saveGoals(g);
    },
    [commit, saveBudgets, saveInvest, saveGoals],
  );

  const clearAll = useCallback(async () => {
    if (!backend.current) return;
    const p = backend.current.reset();
    track(p, 'Não foi possível apagar os dados. Tente de novo.');
    await p.catch(() => undefined);
  }, [track]);

  const expenses = useMemo(() => listOf(overrides), [overrides]);

  const value = useMemo<FinanceContextValue>(
    () => ({
      mode,
      sync,
      ready,
      expenses,
      budgets: storedBudgets ?? DEFAULT_BUDGETS,
      hasChanges: expenses.length > 0 || storedBudgets !== null || invest.list.length > 0 || invest.trades.length > 0 || goals.length > 0,
      save,
      remove,
      apply: commit,
      saveBudgets,
      invest,
      saveInvest,
      goals,
      saveGoals,
      replaceAll,
      clearAll,
    }),
    [mode, sync, ready, expenses, storedBudgets, save, remove, commit, saveBudgets, invest, saveInvest, goals, saveGoals, replaceAll, clearAll],
  );

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}
