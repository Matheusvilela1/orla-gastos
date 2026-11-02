import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlarmClock,
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Car,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  CopyPlus,
  Ellipsis,
  Gift,
  GraduationCap,
  HardDrive,
  HeartPulse,
  House,
  Laptop,
  LoaderCircle,
  PartyPopper,
  Pencil,
  Plus,
  Repeat,
  Search,
  SearchX,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Table2,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Tv,
  X,
  type LucideIcon,
} from 'lucide-react';
import { fmt, fmtDate, normalize, WEEKDAYS_SHORT } from '../lib/format';
import { Poster } from './poster';
import { copyText, useBodyLock, useCountUp, useElementWidth, useFocusTrap, useReducedMotion } from '../lib/hooks';
import {
  CATEGORIES,
  CATEGORY_ORDER,
  PAY_KINDS,
  PAY_KIND_ORDER,
  SAMPLE_BUDGETS,
  STATUS_PRIORITY,
  addDays,
  addMonths,
  buildMonthFinance,
  buildTrend,
  categoriesOf,
  chartMonths,
  daysBetween,
  expenseStatus,
  expensesToTsv,
  financeSummaryText,
  formatBRLInput,
  generateSampleEntries,
  isSample,
  isoDate,
  missingRecurring,
  monthKeyOf,
  monthLabel,
  monthName,
  monthShort,
  navMonths,
  newExpenseId,
  nextOccurrence,
  parseBRL,
  parseIso,
  splitInstallments,
  suggestBudgets,
  type Budgets,
  type Category,
  type EntryKind,
  type Expense,
  type ExpenseCategory,
  type ExpenseStatus,
  type MonthFinance,
  type MonthKey,
  type PayKind,
  type TrendPoint,
} from '../lib/finance';
import { IS_DEMO, useFinance, type Changes, type StorageMode, type SyncState } from '../lib/financeStore';
import { spotlight, useMonthSlide, usePresence } from '../lib/motion';
import { monthMoves } from '../lib/invest';
import { useToast } from './toast';
import { Delta, FloatingTip, Logo, Popover, Segmented, Swatch, cssVars, cx, tipPosition, type TipState } from './ui';

// ---------------------------------------------------------------------------
// Formatação

const MINUS = '−';
const brl0 = (v: number) => (v < -0.5 ? MINUS : '') + fmt.brl(Math.abs(v));
const brl2 = (v: number) => (v < -0.005 ? MINUS : '') + fmt.brl2(Math.abs(v));
const brlK = (v: number) => (v < -0.5 ? MINUS : '') + fmt.brlCompact(Math.abs(v));
const dm = (iso: string) => fmtDate.dayMonth(parseIso(iso));
const pctChange = (cur: number, prev: number) => (prev ? (cur - prev) / Math.abs(prev) : 0);
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  moradia: House,
  mercado: ShoppingCart,
  transporte: Car,
  lazer: PartyPopper,
  saude: HeartPulse,
  educacao: GraduationCap,
  assinaturas: Tv,
  compras: ShoppingBag,
  outros: Ellipsis,
  salario: Briefcase,
  extra: Laptop,
  rendimentos: TrendingUp,
  'outras-receitas': Gift,
};

type Tone = 'good' | 'warning' | 'critical' | 'neutral';

const STATUS_UI: Record<ExpenseStatus, { tone: Tone; icon: LucideIcon; gasto: string; receita: string }> = {
  paga: { tone: 'good', icon: CircleCheck, gasto: 'Paga', receita: 'Recebida' },
  atrasada: { tone: 'critical', icon: TriangleAlert, gasto: 'Atrasada', receita: 'Atrasada' },
  'vence-hoje': { tone: 'warning', icon: AlarmClock, gasto: 'Vence hoje', receita: 'Entra hoje' },
  'vence-breve': { tone: 'warning', icon: Clock, gasto: 'Vence em breve', receita: 'Entra em breve' },
  'a-vencer': { tone: 'neutral', icon: CalendarClock, gasto: 'A vencer', receita: 'A receber' },
};

export const statusLabel = (s: ExpenseStatus, k: EntryKind) => STATUS_UI[s][k];

function statusText(e: Expense, today: string, short = false): string {
  const st = expenseStatus(e, today);
  const receita = e.kind === 'receita';
  if (st === 'paga') return short || !e.paidAt ? statusLabel(st, e.kind) : `${receita ? 'Recebida' : 'Paga'} em ${dm(e.paidAt)}`;
  if (st === 'atrasada') {
    const d = daysBetween(e.dueDate, today);
    return short ? 'Atrasada' : `Atrasada há ${plural(d, 'dia', 'dias')}`;
  }
  if (st === 'vence-breve') {
    const d = daysBetween(today, e.dueDate);
    return receita ? (d === 1 ? 'Entra amanhã' : `Entra em ${d} dias`) : d === 1 ? 'Vence amanhã' : `Vence em ${d} dias`;
  }
  return statusLabel(st, e.kind);
}

function ExpenseStatusPill({ e, today, short }: { e: Expense; today: string; short?: boolean }) {
  const status = expenseStatus(e, today);
  const ui = STATUS_UI[status];
  const Icon = ui.icon;
  // Só "pula" quando a situação muda (ex.: ao pagar), não quando a linha aparece.
  const first = useRef(status);
  const changed = first.current !== status;
  return (
    <span key={status} className="status" data-tone={ui.tone} data-changed={changed ? '' : undefined}>
      <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
      {statusText(e, today, short)}
    </span>
  );
}

function MoneyDelta({ value, goodWhenUp = true, label }: { value: number; goodWhenUp?: boolean; label: string }) {
  const dir = Math.abs(value) < 0.5 ? 'flat' : value > 0 ? 'up' : 'down';
  const tone = dir === 'flat' ? 'flat' : (dir === 'up') === goodWhenUp ? 'good' : 'bad';
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : ArrowRight;
  return (
    <span className="delta" data-tone={tone}>
      <Icon size={14} strokeWidth={2.4} aria-hidden="true" />
      <span>
        {value > 0.5 ? '+' : value < -0.5 ? MINUS : ''}
        {fmt.brlCompact(Math.abs(value))}
      </span>
      <span className="sr-only"> {label}</span>
    </span>
  );
}

export function SyncChip({ mode, sync }: { mode: StorageMode; sync: SyncState }) {
  let Icon: LucideIcon = HardDrive;
  let text = 'Salvo no seu PC';
  let tone: Tone | undefined;
  let title = 'Os lançamentos ficam em dados/orla-financas.json, na pasta do projeto.';
  let spin = false;
  if (mode === 'iniciando') {
    Icon = LoaderCircle;
    text = 'Abrindo';
    title = 'Lendo o arquivo de dados.';
    spin = true;
  } else if (sync === 'salvando') {
    Icon = LoaderCircle;
    text = 'Salvando';
    spin = true;
  } else if (sync === 'erro') {
    Icon = CircleAlert;
    text = 'Erro ao salvar';
    tone = 'critical';
    title = 'A última alteração não foi gravada no arquivo. A cópia do navegador foi mantida.';
  } else if (IS_DEMO) {
    Icon = Sparkles;
    text = 'Demonstração';
    title = 'Os dados são de exemplo e ficam só neste navegador.';
  } else if (mode === 'local') {
    Icon = CircleAlert;
    text = 'Salvo só neste navegador';
    tone = 'warning';
    title = 'O arquivo de dados não respondeu. Abra o painel pelo Iniciar.bat para salvar no PC.';
  }
  return (
    <span className="sync-chip" data-tone={tone} title={title}>
      <Icon size={14} className={spin ? 'spin' : undefined} aria-hidden="true" />
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tela

export type FinanceIntent = { type: 'new'; kind: EntryKind } | { type: 'overdue' } | { type: 'sample' } | { type: 'edit'; expense: Expense };
type LedgerFilter = 'todas' | 'pendentes' | 'atrasadas' | 'pagas';
type EditorMode = 'novo' | 'editar' | 'duplicar';
interface EditorState {
  mode: EditorMode;
  kind: EntryKind;
  expense?: Expense;
  nonce: number;
}

export function FinanceView({
  now,
  month,
  onMonth,
  intent,
  onIntentDone,
}: {
  now: Date;
  month: MonthKey;
  onMonth: (k: MonthKey) => void;
  intent: FinanceIntent | null;
  onIntentDone: () => void;
}) {
  const fin = useFinance();
  const toast = useToast();
  const reduced = useReducedMotion();
  const today = isoDate(now);
  const currentMonth = monthKeyOf(now);
  const months = useMemo(() => navMonths(currentMonth, month, fin.expenses), [currentMonth, month, fin.expenses]);
  const model = useMemo(() => buildMonthFinance(month, fin.expenses, fin.budgets, today), [month, fin.expenses, fin.budgets, today]);
  const trend = useMemo(() => buildTrend(chartMonths(currentMonth, month, fin.expenses), fin.expenses, currentMonth), [currentMonth, month, fin.expenses]);

  const [kind, setKind] = useState<EntryKind>('gasto');
  const [filter, setFilter] = useState<LedgerFilter>('todas');
  const [category, setCategory] = useState<Category | 'todas'>('todas');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const ledgerRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const nonce = useRef(0);
  const [shownEditor, editorLeaving] = usePresence(editor, 240);
  useMonthSlide(gridRef, month, '.fin-summary, .ledger-block > .block-head, .sheet-fin-split > *');

  const soonLimit = isoDate(addDays(now, 3));
  const unpaidGastos = useMemo(() => fin.expenses.filter((e) => e.kind === 'gasto' && !e.paidAt), [fin.expenses]);
  const overdue = useMemo(() => unpaidGastos.filter((e) => e.dueDate < today), [unpaidGastos, today]);
  const dueSoon = useMemo(() => unpaidGastos.filter((e) => e.dueDate >= today && e.dueDate <= soonLimit), [unpaidGastos, today, soonLimit]);
  const missing = useMemo(() => (month >= currentMonth ? missingRecurring(fin.expenses, month) : []), [fin.expenses, month, currentMonth]);
  const samples = useMemo(() => fin.expenses.filter(isSample), [fin.expenses]);
  const invested = useMemo(() => monthMoves(fin.invest.list, month), [fin.invest.list, month]);

  const scrollToLedger = () => {
    window.requestAnimationFrame(() => ledgerRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }));
  };

  const focusLedger = (next: { kind?: EntryKind; filter?: LedgerFilter; category?: Category | 'todas'; month?: MonthKey }) => {
    if (next.month && next.month !== month) onMonth(next.month);
    setKind(next.kind ?? 'gasto');
    setFilter(next.filter ?? 'todas');
    setCategory(next.category ?? 'todas');
    setQuery('');
    scrollToLedger();
  };

  const changeKind = (k: EntryKind) => {
    setKind(k);
    setFilter('todas');
    setCategory('todas');
  };

  const latestOrCurrent = (list: Expense[]) => {
    const ms = [...new Set(list.map((e) => e.competence))].sort();
    return ms.includes(month) ? month : ms[ms.length - 1];
  };
  const showOverdue = () => focusLedger({ filter: 'atrasadas', month: latestOrCurrent(overdue) });
  const showDueSoon = () => focusLedger({ filter: 'pendentes', month: latestOrCurrent(dueSoon) });

  const openNew = (k: EntryKind = kind) => setEditor({ mode: 'novo', kind: k, nonce: ++nonce.current });
  const openEdit = (e: Expense) => setEditor({ mode: 'editar', kind: e.kind, expense: e, nonce: ++nonce.current });
  const openDuplicate = (e: Expense) => setEditor({ mode: 'duplicar', kind: e.kind, expense: e, nonce: ++nonce.current });

  const undoable = (message: string, undo: Changes) =>
    toast(message, 'success', {
      action: {
        label: 'Desfazer',
        run: () => {
          fin.apply(undo);
          toast('Alteração desfeita', 'info');
        },
      },
    });

  const quoted = (e: Expense) => `“${e.description}”`;

  const loadSample = () => {
    fin.save(generateSampleEntries(now));
    fin.saveBudgets(SAMPLE_BUDGETS);
    onMonth(currentMonth);
    toast('Dados de exemplo carregados. Apague quando quiser começar com os seus.', 'info');
  };

  const removeSamples = () => {
    const undo = fin.remove(samples.map((e) => e.id));
    undoable(`${plural(samples.length, 'lançamento de exemplo apagado', 'lançamentos de exemplo apagados')}`, undo);
  };

  useEffect(() => {
    if (!intent) return;
    if (intent.type === 'new') openNew(intent.kind);
    else if (intent.type === 'sample') loadSample();
    else if (intent.type === 'edit') {
      onMonth(intent.expense.competence);
      changeKind(intent.expense.kind);
      openEdit(intent.expense);
    } else showOverdue();
    onIntentDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const pay = (list: Expense[]) => {
    const targets = list.filter((e) => !e.paidAt);
    if (!targets.length) return;
    const undo = fin.save(targets.map((e) => ({ ...e, paidAt: today })));
    const done = (e: Expense) => (e.kind === 'receita' ? 'Recebimento' : 'Pagamento');
    undoable(targets.length === 1 ? `${done(targets[0])} de ${quoted(targets[0])} registrado` : `${targets.length} lançamentos marcados como pagos`, undo);
  };

  const removeMany = (list: Expense[]) => {
    if (!list.length) return;
    const undo = fin.remove(list.map((e) => e.id));
    undoable(list.length === 1 ? `Lançamento ${quoted(list[0])} excluído` : `${list.length} lançamentos excluídos`, undo);
  };

  const launchMissing = () => {
    const created = missing.map((e) => nextOccurrence(e, month, newExpenseId()));
    const undo = fin.save(created);
    undoable(created.length === 1 ? `${quoted(created[0])} adicionado a ${monthLabel(month)}` : `${created.length} lançamentos fixos adicionados a ${monthLabel(month)}`, undo);
  };

  const submitExpense = (list: Expense[], mode: EditorMode) => {
    const undo = fin.save(list);
    setEditor(null);
    const first = list[0];
    const last = list[list.length - 1];
    const message =
      mode === 'editar'
        ? 'Alterações salvas'
        : list.length > 1
          ? `${list.length} parcelas lançadas, de ${monthLabel(first.competence)} a ${monthLabel(last.competence)}`
          : `${first.kind === 'gasto' ? 'Gasto lançado' : 'Receita lançada'} em ${monthLabel(first.competence)}`;
    if (first.competence !== month) toast(message, 'success', { action: { label: `Ver ${monthName(first.competence).toLowerCase()}`, run: () => onMonth(first.competence) } });
    else undoable(message, undo);
    if (first.kind !== kind) changeKind(first.kind);
  };

  const deleteFromEditor = (e: Expense) => {
    setEditor(null);
    removeMany([e]);
  };

  const copySummary = () => {
    copyText(financeSummaryText(model, brl2, (v) => fmt.pct(v))).then((ok) =>
      toast(ok ? 'Resumo do mês copiado' : 'Não foi possível copiar o resumo neste navegador.', ok ? 'success' : 'error'),
    );
  };

  const saveBudgets = (b: Budgets | null) => {
    const previous = fin.saveBudgets(b);
    toast('Orçamentos salvos', 'success', { action: { label: 'Desfazer', run: () => fin.saveBudgets(previous) } });
  };

  const editorEl = shownEditor ? (
    <ExpenseDrawer
      key={shownEditor.nonce}
      state={shownEditor}
      leaving={editorLeaving}
      month={month}
      months={months}
      today={today}
      all={fin.expenses}
      onClose={() => setEditor(null)}
      onSubmit={submitExpense}
      onDelete={deleteFromEditor}
      onDuplicate={openDuplicate}
    />
  ) : null;

  if (fin.ready && fin.expenses.length === 0) {
    return (
      <>
        <Welcome mode={fin.mode} onNew={openNew} onSample={loadSample} />
        {editorEl}
      </>
    );
  }

  const sobra = model.lucro >= 0;
  return (
    <>
      <Poster
        kicker={`Meu mês · ${model.label}`}
        lines={[{ text: sobra ? (model.inProgress ? 'Sobrando' : 'Sobrou') : model.inProgress ? 'Faltando' : 'Faltou' }, { text: fmt.brl(Math.abs(model.lucro)), accent: true }]}
        sub={model.revenue ? `De ${fmt.brl(model.revenue)} que entrou, ${fmt.brl(model.gastos)} foram para gastos.` : 'Lance suas receitas para ver quanto sobra.'}
      />
      <FinanceBar model={model} months={months} trend={trend} today={today} onMonth={onMonth} onNew={() => openNew()} onCopy={copySummary} />
      <div className="grid fin-grid" ref={gridRef} data-syncing={fin.ready ? undefined : ''}>
        <FinanceAlerts
          overdue={overdue}
          dueSoon={dueSoon}
          missing={missing}
          samples={samples.length}
          month={month}
          soonLimit={soonLimit}
          onShowOverdue={showOverdue}
          onShowDueSoon={showDueSoon}
          onLaunchMissing={launchMissing}
          onRemoveSamples={removeSamples}
        />

        <section className="sheet sheet-fin-hero" aria-labelledby="fin-resultado" onPointerMove={spotlight}>
          <ResultSummary model={model} invested={invested.aportes - invested.resgates} />
          <div className="fin-chart">
            <ProfitChart points={trend} selected={month} onSelect={onMonth} />
          </div>
        </section>

        <section className="sheet sheet-ledger" ref={ledgerRef} aria-labelledby="fin-despesas">
          <Ledger
            model={model}
            today={today}
            kind={kind}
            onKind={changeKind}
            filter={filter}
            onFilter={setFilter}
            category={category}
            onCategory={setCategory}
            query={query}
            onQuery={setQuery}
            onNew={() => openNew()}
            onEdit={openEdit}
            onPay={pay}
            onRemove={removeMany}
            mode={fin.mode}
            sync={fin.sync}
          />
        </section>

        <section className="sheet sheet-split sheet-fin-split" aria-label="Orçamento e resumo do mês">
          <BudgetBlock model={model} all={fin.expenses} budgets={fin.budgets} onSave={saveBudgets} onShowCategory={(c) => focusLedger({ category: c })} />
          <SummaryBlock model={model} onShowCategory={(c, k) => focusLedger({ category: c, kind: k })} />
        </section>
      </div>
      {editorEl}
    </>
  );
}

// ---------------------------------------------------------------------------
// Primeira visita

function Welcome({ mode, onNew, onSample }: { mode: StorageMode; onNew: (k: EntryKind) => void; onSample: () => void }) {
  return (
    <section className="sheet sheet-solo fin-welcome" aria-labelledby="boas-vindas">
      <Logo size={52} />
      <h2 id="boas-vindas" className="fin-welcome-title">
        Suas finanças, num lugar só
      </h2>
      <p className="fin-welcome-text">Anote o que entra e o que sai, veja quanto sobra no mês, acompanhe o orçamento e não esqueça nenhuma conta.</p>
      <div className="fin-welcome-options">
        <button type="button" className="fin-welcome-opt" onClick={() => onNew('receita')}>
          <Briefcase size={22} aria-hidden="true" />
          <strong>Começar pela renda</strong>
          <span>Lance o salário ou outra receita</span>
        </button>
        <button type="button" className="fin-welcome-opt" onClick={() => onNew('gasto')}>
          <Plus size={22} aria-hidden="true" />
          <strong>Lançar um gasto</strong>
          <span>Uma conta, uma compra, o mercado</span>
        </button>
        <button type="button" className="fin-welcome-opt" onClick={onSample}>
          <Sparkles size={22} aria-hidden="true" />
          <strong>Ver com dados de exemplo</strong>
          <span>Dá para apagar depois</span>
        </button>
      </div>
      <p className="fin-welcome-note">
        <HardDrive size={14} aria-hidden="true" />
        {IS_DEMO
          ? 'Esta é a demonstração: o que você lançar fica só neste navegador.'
          : mode === 'local'
          ? 'O arquivo de dados não respondeu, então tudo fica salvo neste navegador. Abra pelo Iniciar.bat para salvar no PC.'
          : 'Tudo fica num arquivo neste computador. Nada vai para a internet.'}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Barra do mês

function FinanceBar({
  model,
  months,
  trend,
  today,
  onMonth,
  onNew,
  onCopy,
}: {
  model: MonthFinance;
  months: MonthKey[];
  trend: TrendPoint[];
  today: string;
  onMonth: (k: MonthKey) => void;
  onNew: () => void;
  onCopy: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const prevKey = addMonths(model.key, -1);
  const current = today.slice(0, 7);
  const status = model.inProgress
    ? `Mês em andamento, hoje é ${dm(today)}`
    : model.key > current
      ? 'Mês futuro: contas agendadas e parcelas'
      : 'Mês encerrado';
  return (
    <div className="fin-bar">
      <div className="month-step" role="group" aria-label="Mês">
        <button type="button" className="icon-btn sm" onClick={() => onMonth(addMonths(model.key, -1))} aria-label="Mês anterior" title="Mês anterior (←)">
          <ChevronLeft size={17} aria-hidden="true" />
        </button>
        <div className="pop-anchor month-anchor">
          <button ref={btnRef} type="button" className="month-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <CalendarDays size={15} aria-hidden="true" />
            <span key={model.key} className="month-label">
              {monthName(model.key)} de {model.key.slice(0, 4)}
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} label="Escolher o mês" className="menu month-menu">
            <div role="menu" aria-label="Meses">
              {[...months].reverse().map((k) => {
                const p = trend.find((t) => t.key === k);
                return (
                  <button
                    key={k}
                    type="button"
                    role="menuitemradio"
                    aria-checked={k === model.key}
                    className="menu-item"
                    onClick={() => {
                      onMonth(k);
                      setOpen(false);
                    }}
                  >
                    <span>{monthLabel(k)}</span>
                    {p && (p.revenue || p.gastos) ? (
                      <span className="menu-meta" data-neg={p.lucro < 0 ? '' : undefined}>
                        {brlK(p.lucro)}
                      </span>
                    ) : null}
                    <Check size={16} strokeWidth={2.6} className="menu-check" aria-hidden="true" style={{ visibility: k === model.key ? 'visible' : 'hidden' }} />
                  </button>
                );
              })}
            </div>
          </Popover>
        </div>
        <button type="button" className="icon-btn sm" onClick={() => onMonth(addMonths(model.key, 1))} aria-label="Próximo mês" title="Próximo mês (→)">
          <ChevronRight size={17} aria-hidden="true" />
        </button>
        {model.key !== current ? (
          <button type="button" className="link-btn month-today" onClick={() => onMonth(current)}>
            Mês atual
          </button>
        ) : null}
      </div>
      <p className="period-text">
        <Clock size={15} aria-hidden="true" />
        <span>
          <span className="period-main">{status}</span>
          {model.prev ? <span className="period-compare">comparado a {monthLabel(prevKey)}</span> : null}
        </span>
      </p>
      <div className="fin-bar-actions">
        <button type="button" className="btn btn-secondary" onClick={onCopy}>
          <Copy size={15} aria-hidden="true" />
          Copiar resumo
        </button>
        <button type="button" className="btn btn-primary" onClick={onNew} title="Atalho: N">
          <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
          Novo lançamento
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Avisos

function FinanceAlerts({
  overdue,
  dueSoon,
  missing,
  samples,
  month,
  soonLimit,
  onShowOverdue,
  onShowDueSoon,
  onLaunchMissing,
  onRemoveSamples,
}: {
  overdue: Expense[];
  dueSoon: Expense[];
  missing: Expense[];
  samples: number;
  month: MonthKey;
  soonLimit: string;
  onShowOverdue: () => void;
  onShowDueSoon: () => void;
  onLaunchMissing: () => void;
  onRemoveSamples: () => void;
}) {
  if (!overdue.length && !dueSoon.length && !missing.length && !samples) return null;
  const sum = (l: Expense[]) => l.reduce((a, e) => a + e.amount, 0);
  return (
    <section className="fin-alerts" aria-label="Avisos">
      {samples ? (
        <div className="fin-alert" data-tone="neutral">
          <span className="fin-alert-icon">
            <Sparkles size={18} aria-hidden="true" />
          </span>
          <p>
            <strong>Você está vendo dados de exemplo.</strong> Apague quando quiser começar com os seus; o que você lançou continua.
          </p>
          <button type="button" className="btn btn-secondary sm" onClick={onRemoveSamples}>
            Apagar exemplos
          </button>
        </div>
      ) : null}
      {overdue.length ? (
        <div className="fin-alert" data-tone="critical">
          <span className="fin-alert-icon">
            <TriangleAlert size={18} aria-hidden="true" />
          </span>
          <p>
            <strong>{plural(overdue.length, 'conta atrasada', 'contas atrasadas')}</strong>, somando {brl2(sum(overdue))}: {overdue.slice(0, 3).map((e) => `${e.description} (${dm(e.dueDate)})`).join(', ')}
            {overdue.length > 3 ? ` e mais ${overdue.length - 3}` : ''}.
          </p>
          <button type="button" className="btn btn-secondary sm" onClick={onShowOverdue}>
            Ver atrasadas
          </button>
        </div>
      ) : null}
      {dueSoon.length ? (
        <div className="fin-alert" data-tone="warning">
          <span className="fin-alert-icon">
            <Clock size={18} aria-hidden="true" />
          </span>
          <p>
            <strong>
              {plural(dueSoon.length, 'conta vence', 'contas vencem')} até {dm(soonLimit)}
            </strong>
            , somando {brl2(sum(dueSoon))}.
          </p>
          <button type="button" className="btn btn-secondary sm" onClick={onShowDueSoon}>
            Ver contas
          </button>
        </div>
      ) : null}
      {missing.length ? (
        <div className="fin-alert" data-tone="neutral">
          <span className="fin-alert-icon">
            <Repeat size={18} aria-hidden="true" />
          </span>
          <p>
            <strong>{plural(missing.length, 'lançamento fixo', 'lançamentos fixos')}</strong> de {monthLabel(addMonths(month, -1))}{' '}
            {missing.length === 1 ? 'ainda não foi lançado' : 'ainda não foram lançados'} neste mês: {missing.slice(0, 3).map((e) => e.description).join(', ')}
            {missing.length > 3 ? ` e mais ${missing.length - 3}` : ''}.
          </p>
          <button type="button" className="btn btn-secondary sm" onClick={onLaunchMissing}>
            Lançar agora
          </button>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Saldo do mês

/** Valor em reais que corre até o novo número quando ele muda. */
function CountUp({ value }: { value: number }) {
  return <span className="count">{brl2(useCountUp(value))}</span>;
}

function ResultSummary({ model, invested }: { model: MonthFinance; invested: number }) {
  const saldo = useCountUp(model.lucro);
  const neg = model.lucro < 0;
  const prev = model.prev;
  const prevName = monthName(addMonths(model.key, -1)).toLowerCase();
  const caption = !model.revenue
    ? 'Lance suas receitas deste mês para ver quanto sobra.'
    : neg
      ? `Os gastos passaram a renda em ${fmt.pct(-model.margem)}.`
      : `Você guardou ${fmt.pct(model.margem)} do que entrou.`;
  return (
    <div className="fin-summary">
      <div className="fin-summary-head">
        <h2 className="card-title" id="fin-resultado">
          {!model.revenue ? 'Saldo do mês' : neg ? 'Faltou no mês' : 'Sobrou no mês'}
        </h2>
        {/* Sem receita lançada (ex.: um mês futuro só com parcelas) o saldo negativo não é alarme. */}
        {neg && model.revenue ? (
          <span className="status" data-tone="critical">
            <TriangleAlert size={14} strokeWidth={2.2} aria-hidden="true" />
            Gastou mais do que ganhou
          </span>
        ) : null}
      </div>
      <p className="hero-figure">
        <span className="hero-value" data-neg={neg ? '' : undefined}>
          {brl2(saldo)}
        </span>
        {prev ? <MoneyDelta value={model.lucro - prev.lucro} label={`em relação a ${prevName}`} /> : null}
      </p>
      <p className="hero-caption">
        {caption}
        {prev ? ` Em ${prevName}: ${brl0(prev.lucro)}.` : ''}
      </p>

      <dl className="fin-kv">
        <div>
          <dt>Receitas</dt>
          <dd>
            <CountUp value={model.revenue} />
            {prev ? <Delta value={pctChange(model.revenue, prev.revenue)} /> : null}
          </dd>
          {model.toReceive > 0.005 ? <span className="fin-kv-sub">{brl2(model.toReceive)} a receber</span> : null}
        </div>
        <div>
          <dt>Gastos</dt>
          <dd>
            <CountUp value={model.gastos} />
            {prev ? <Delta value={pctChange(model.gastos, prev.gastos)} goodWhenUp={false} /> : null}
          </dd>
          {model.ledger.pending > 0.005 ? <span className="fin-kv-sub">{brl2(model.ledger.pending)} a pagar</span> : null}
        </div>
        {Math.abs(invested) > 0.005 ? (
          <div>
            {/* Investir não é gasto: o dinheiro continua seu. Mostra quanto sobra livre depois de investir. */}
            <dt>{invested > 0 ? 'Investido' : 'Resgatado de investimentos'}</dt>
            <dd>
              <CountUp value={Math.abs(invested)} />
            </dd>
            {invested > 0 && model.revenue ? <span className="fin-kv-sub">{brl2(model.lucro - invested)} livres depois de investir</span> : null}
          </div>
        ) : null}
      </dl>

      <MoneySplit model={model} />

      {model.inProgress ? <p className="side-note">Mês em andamento: as contas que ainda vão vencer já entram nos gastos.</p> : null}
    </div>
  );
}

function MoneySplit({ model }: { model: MonthFinance }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const rev = model.revenue;
  const base = rev || model.gastos || 1;
  const scale = Math.max(rev, model.gastos) || 1;
  const parts = [
    ...CATEGORY_ORDER.filter((c) => model.byCategory[c].total > 0).map((c) => ({ id: c, label: CATEGORIES[c].label, color: CATEGORIES[c].color, value: model.byCategory[c].total })),
    ...(model.lucro > 0 ? [{ id: 'sobra', label: 'Sobrou', color: 'var(--sobra)', value: model.lucro }] : []),
  ];
  const per100Text = (v: number) => `R$ ${fmt.dec((v / base) * 100, 2)}`;
  const show = (e: ReactPointerEvent<HTMLElement>, i: number) => {
    if (!boxRef.current) return;
    const p = parts[i];
    setTip({
      ...tipPosition(e.currentTarget, boxRef.current, 90),
      content: (
        <>
          <strong>{brl2(p.value)}</strong>
          <span className="ftip-sub">
            {p.label}, {per100Text(p.value)} de cada R$ 100
          </span>
        </>
      ),
    });
  };
  if (!parts.length) return null;
  return (
    <div className="split">
      <p className="split-title">
        {!rev
          ? 'Para onde foram os gastos, de cada R$ 100'
          : model.lucro >= 0
            ? `De cada R$ 100 que entraram, ${per100Text(model.lucro)} sobraram`
            : `Os gastos passaram a renda em ${brl2(-model.lucro)}`}
      </p>
      <div className="split-box" ref={boxRef}>
        <div className="stackbar split-bar" role="img" aria-label={parts.map((p) => `${p.label}: ${brl2(p.value)}`).join(', ')}>
          {parts.map((p, i) => (
            <span
              key={p.id}
              className="stackbar-seg"
              style={{ flexGrow: p.value / scale, background: p.color }}
              onPointerEnter={(e) => show(e, i)}
              onPointerLeave={() => setTip(null)}
            />
          ))}
          {rev && model.gastos > rev ? <span className="split-mark" style={{ left: `${(rev / scale) * 100}%` }} title="Receitas" /> : null}
        </div>
        <FloatingTip tip={tip} />
      </div>
      <ul className="split-legend">
        {parts.map((p) => (
          <li key={p.id} data-strong={p.id === 'sobra' ? '' : undefined}>
            <Swatch color={p.color} />
            <span className="split-name">{p.label}</span>
            <span className="split-per">{per100Text(p.value)}</span>
            <span className="split-value">{brlK(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saldo por mês (colunas em HTML: acessível por teclado e com alvo maior que a barra)

function niceSigned(min: number, max: number, count: number) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  // Passo mínimo de R$ 1: com meses zerados, passos menores arredondariam para rótulos repetidos.
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const bottom = Math.min(0, Math.floor(min / step) * step);
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 1000; v += step) ticks.push(Math.round(v) || 0);
  return { top, bottom, ticks };
}

function ProfitChart({ points, selected, onSelect }: { points: TrendPoint[]; selected: MonthKey; onSelect: (k: MonthKey) => void }) {
  const [asTable, setAsTable] = useState(false);
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const cols = useRef<(HTMLButtonElement | null)[]>([]);
  const [tip, setTip] = useState<TipState | null>(null);
  const max = Math.max(0, ...points.map((p) => p.lucro));
  const min = Math.min(0, ...points.map((p) => p.lucro));
  const { top, bottom, ticks } = niceSigned(min, max, width > 0 && width < 420 ? 3 : 4);
  const H = width > 0 && width < 520 ? 170 : 200;
  const y = (v: number) => ((top - v) / (top - bottom)) * H;
  const y0 = y(0);
  const selIdx = Math.max(0, points.findIndex((p) => p.key === selected));
  const sparse = width > 0 && (width - 52) / points.length < 40;
  const partial = points.find((p) => p.inProgress);
  const word = (v: number) => (v < 0 ? 'faltou' : 'sobrou');

  const show = (i: number) => {
    const bar = bars.current[i];
    if (!bar || !boxRef.current) return;
    const p = points[i];
    setTip({
      ...tipPosition(bar, boxRef.current, 100),
      content: (
        <>
          <strong>
            {p.lucro < 0 ? 'Faltou' : 'Sobrou'} {brl0(Math.abs(p.lucro))}
          </strong>
          <span className="ftip-sub">
            {monthLabel(p.key)}
            {p.inProgress ? ', em andamento' : ''}
          </span>
          <span className="ftip-sub">
            Receitas {brlK(p.revenue)}, gastos {brlK(p.gastos)}
            {p.revenue ? `, guardou ${fmt.pct(Math.max(0, p.margem), 0)}` : ''}
          </span>
        </>
      ),
    });
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? points.length - 1 : dir ? Math.min(points.length - 1, Math.max(0, selIdx + dir)) : -1;
    if (to < 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(points[to].key);
    cols.current[to]?.focus();
  };

  return (
    <div className="pchart-wrap" ref={wrapRef}>
      <div className="block-head">
        <div>
          <h3 className="card-title">Saldo por mês</h3>
          <p className="block-sub">Quanto sobrou ou faltou. Clique num mês para abri-lo</p>
        </div>
        <button type="button" className="chip-btn" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? <ChartColumn size={15} aria-hidden="true" /> : <Table2 size={15} aria-hidden="true" />}
          {asTable ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </div>

      {asTable ? (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Saldo por mês em tabela">
          <table className="data-table compact">
            <thead>
              <tr>
                <th scope="col">Mês</th>
                <th scope="col" className="num">
                  Receitas
                </th>
                <th scope="col" className="num">
                  Gastos
                </th>
                <th scope="col" className="num">
                  Saldo
                </th>
                <th scope="col" className="num">
                  Guardou
                </th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.key} className="row-click" data-selected={p.key === selected ? '' : undefined} onClick={() => onSelect(p.key)}>
                  <th scope="row">
                    {monthLabel(p.key)}
                    {p.inProgress ? <span className="tag">em andamento</span> : null}
                  </th>
                  <td className="num">{brl0(p.revenue)}</td>
                  <td className="num">{brl0(p.gastos)}</td>
                  <td className={cx('num', 'strong', p.lucro < 0 && 'num-neg')}>{brl0(p.lucro)}</td>
                  <td className="num">{p.revenue ? fmt.pct(p.margem) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pchart" ref={boxRef} style={cssVars({ '--n': points.length })}>
          <div className="pchart-plot" style={{ height: H }}>
            <div className="pchart-y" aria-hidden="true">
              {ticks.map((t) => (
                <span key={t} style={{ top: y(t) }}>
                  {t === 0 ? '0' : (t < 0 ? MINUS : '') + fmt.compact(Math.abs(t))}
                </span>
              ))}
            </div>
            <div className="pchart-area">
              {ticks.map((t) => (
                <span key={t} className="pchart-grid" data-zero={t === 0 ? '' : undefined} style={{ top: y(t) }} />
              ))}
              <div className="pchart-cols" role="radiogroup" aria-label="Saldo por mês" onKeyDown={onKey}>
                {points.map((p, i) => {
                  const neg = p.lucro < 0;
                  const barTop = neg ? y0 : y(p.lucro);
                  const barH = Math.max(2, Math.abs(y(p.lucro) - y0));
                  const isSel = i === selIdx;
                  return (
                    <button
                      key={p.key}
                      ref={(el) => {
                        cols.current[i] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={isSel}
                      tabIndex={isSel ? 0 : -1}
                      className="pchart-col"
                      style={cssVars({ '--i': i })}
                      aria-label={`${monthLabel(p.key)}: ${word(p.lucro)} ${brl0(Math.abs(p.lucro))}${p.inProgress ? ', mês em andamento' : ''}`}
                      onClick={() => onSelect(p.key)}
                      onPointerEnter={() => show(i)}
                      onPointerLeave={() => setTip(null)}
                      onFocus={() => show(i)}
                      onBlur={() => setTip(null)}
                    >
                      <span
                        ref={(el) => {
                          bars.current[i] = el;
                        }}
                        className="pchart-bar"
                        data-neg={neg ? '' : undefined}
                        style={{ top: barTop, height: barH }}
                      />
                      {isSel ? (
                        <span
                          className="pchart-value"
                          data-neg={neg ? '' : undefined}
                          data-edge={i === 0 ? 'start' : i === points.length - 1 ? 'end' : undefined}
                          style={{ top: neg ? barTop + barH + 4 : barTop - 20 }}
                        >
                          {brlK(p.lucro)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="pchart-x" aria-hidden="true">
            <span />
            {points.map((p, i) => (
              <span key={p.key} data-selected={i === selIdx ? '' : undefined}>
                {sparse && i % 2 === 1 && i !== selIdx ? '' : monthShort(p.key)}
              </span>
            ))}
          </div>
          <FloatingTip tip={tip} />
        </div>
      )}
      {partial ? <p className="pchart-note">{monthName(partial.key)} ainda está em andamento.</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lançamentos do mês

type SortKey = 'prioridade' | 'vencimento' | 'valor' | 'descricao';
const SORT_DEFAULT_DIR: Record<Exclude<SortKey, 'prioridade'>, 'asc' | 'desc'> = { vencimento: 'asc', valor: 'desc', descricao: 'asc' };

const FILTERS: Record<EntryKind, { value: LedgerFilter; label: string }[]> = {
  gasto: [
    { value: 'todas', label: 'Todos' },
    { value: 'pendentes', label: 'A pagar' },
    { value: 'atrasadas', label: 'Atrasados' },
    { value: 'pagas', label: 'Pagos' },
  ],
  receita: [
    { value: 'todas', label: 'Todas' },
    { value: 'pendentes', label: 'A receber' },
    { value: 'atrasadas', label: 'Atrasadas' },
    { value: 'pagas', label: 'Recebidas' },
  ],
};

const KIND_OPTIONS: { value: EntryKind; label: string }[] = [
  { value: 'gasto', label: 'Gastos' },
  { value: 'receita', label: 'Receitas' },
];

function Ledger({
  model,
  today,
  kind,
  onKind,
  filter,
  onFilter,
  category,
  onCategory,
  query,
  onQuery,
  onNew,
  onEdit,
  onPay,
  onRemove,
  mode,
  sync,
}: {
  model: MonthFinance;
  today: string;
  kind: EntryKind;
  onKind: (k: EntryKind) => void;
  filter: LedgerFilter;
  onFilter: (f: LedgerFilter) => void;
  category: Category | 'todas';
  onCategory: (c: Category | 'todas') => void;
  query: string;
  onQuery: (q: string) => void;
  onNew: () => void;
  onEdit: (e: Expense) => void;
  onPay: (list: Expense[]) => void;
  onRemove: (list: Expense[]) => void;
  mode: StorageMode;
  sync: SyncState;
}) {
  const toast = useToast();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'prioridade', dir: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const asCards = width > 0 && width < 640;
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const gasto = kind === 'gasto';
  const entries = gasto ? model.expenses : model.incomes;
  const stats = gasto ? model.ledger : model.incomeLedger;
  const noun = (n: number) => (gasto ? plural(n, 'gasto', 'gastos') : plural(n, 'receita', 'receitas'));

  useEffect(() => {
    setSelected(new Set());
    setExpanded(false);
  }, [model.key, kind, filter, category, query]);

  const counts = useMemo(() => {
    const c: Record<LedgerFilter, number> = { todas: 0, pendentes: 0, atrasadas: 0, pagas: 0 };
    for (const e of entries) {
      if (category !== 'todas' && e.category !== category) continue;
      c.todas++;
      if (e.paidAt) c.pagas++;
      else {
        c.pendentes++;
        if (e.dueDate < today) c.atrasadas++;
      }
    }
    return c;
  }, [entries, category, today]);

  const list = useMemo(() => {
    const q = normalize(query.trim());
    const arr = entries.filter((e) => {
      if (category !== 'todas' && e.category !== category) return false;
      if (filter === 'pagas' && !e.paidAt) return false;
      if (filter === 'pendentes' && e.paidAt) return false;
      if (filter === 'atrasadas' && (e.paidAt || e.dueDate >= today)) return false;
      if (q && !normalize(`${e.description} ${e.supplier} ${e.notes} ${CATEGORIES[e.category].label} ${PAY_KINDS[e.method]} ${formatBRLInput(e.amount)}`).includes(q)) return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sort.key === 'prioridade') {
        const p = STATUS_PRIORITY[expenseStatus(a, today)] - STATUS_PRIORITY[expenseStatus(b, today)];
        return p || (a.paidAt ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate)) || b.amount - a.amount;
      }
      if (sort.key === 'vencimento') return dir * (a.dueDate.localeCompare(b.dueDate) || a.description.localeCompare(b.description, 'pt-BR'));
      if (sort.key === 'valor') return dir * (a.amount - b.amount);
      return dir * a.description.localeCompare(b.description, 'pt-BR');
    });
    return arr;
  }, [entries, category, filter, query, sort, today]);

  const totals = useMemo(() => {
    let total = 0;
    let paid = 0;
    for (const e of list) {
      total += e.amount;
      if (e.paidAt) paid += e.amount;
    }
    return { total, paid, pending: total - paid };
  }, [list]);

  const filtered = filter !== 'todas' || category !== 'todas' || query.trim() !== '';
  // Sem filtros, mostra primeiro os 12 mais urgentes (a ordem padrão é por prioridade).
  const LIMIT = 12;
  const truncated = !filtered && !expanded && list.length > LIMIT + 2;
  const visible = truncated ? list.slice(0, LIMIT) : list;
  const selectedList = visible.filter((e) => selected.has(e.id));
  const selectedPending = selectedList.filter((e) => !e.paidAt);
  const allSelected = visible.length > 0 && selectedList.length === visible.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.map((e) => e.id)));

  const sortBy = (key: Exclude<SortKey, 'prioridade'>) =>
    setSort((s) => {
      if (s.key !== key) return { key, dir: SORT_DEFAULT_DIR[key] };
      if (s.dir === SORT_DEFAULT_DIR[key]) return { key, dir: s.dir === 'asc' ? 'desc' : 'asc' };
      return { key: 'prioridade', dir: 'asc' };
    });
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined);
  const sortIcon = (k: SortKey) =>
    sort.key !== k ? <ArrowUpDown size={13} aria-hidden="true" /> : sort.dir === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />;

  const clearFilters = () => {
    onFilter('todas');
    onCategory('todas');
    onQuery('');
  };

  const copyList = () => {
    setMenuOpen(false);
    copyText(expensesToTsv(list, today, statusLabel)).then((ok) =>
      toast(ok ? `${noun(list.length)} ${list.length === 1 ? 'copiado' : 'copiados'}. Cole numa planilha.` : 'Não foi possível copiar neste navegador.', ok ? 'success' : 'error'),
    );
  };

  const monthTitle = monthLabel(model.key);
  const payWord = gasto ? 'Pagar' : 'Receber';
  const instTag = (e: Expense) => (e.installment ? <span className="tag">{`${e.installment.n}/${e.installment.total}`}</span> : null);

  return (
    <div className="block ledger-block" ref={boxRef}>
      <div className="block-head">
        <div>
          <h2 className="card-title" id="fin-despesas">
            Lançamentos do mês
          </h2>
          <p className="block-sub">
            {noun(stats.count)} em {monthTitle}, {brl2(stats.total)} no total
          </p>
        </div>
        <div className="ledger-head-actions">
          <SyncChip mode={mode} sync={sync} />
          <div className="pop-anchor">
            <button
              ref={menuBtn}
              type="button"
              className="icon-btn sm"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Mais opções"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Ellipsis size={18} aria-hidden="true" />
            </button>
            <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuBtn} label="Opções dos lançamentos" className="menu ledger-menu">
              <div role="menu" aria-label="Opções">
                <button type="button" role="menuitem" className="menu-item" onClick={copyList} disabled={!list.length}>
                  <Copy size={16} aria-hidden="true" />
                  <span>Copiar lista para planilha</span>
                </button>
              </div>
            </Popover>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <Segmented id="tipo-lancamento" label="Tipo de lançamento" value={kind} options={KIND_OPTIONS} onChange={onKind} />
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <input
            id="busca-despesas"
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={gasto ? 'Buscar descrição, local ou valor' : 'Buscar descrição ou valor'}
            aria-label="Buscar lançamentos"
            autoComplete="off"
          />
          {query ? (
            <button type="button" className="search-clear" onClick={() => onQuery('')} aria-label="Limpar busca">
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <label className="select">
          <span className="sr-only">Categoria</span>
          <select id="categoria-despesas" value={category} onChange={(e) => onCategory(e.target.value as Category | 'todas')}>
            <option value="todas">Todas as categorias</option>
            {categoriesOf(kind).map((c) => (
              <option key={c} value={c}>
                {CATEGORIES[c].label}
              </option>
            ))}
          </select>
        </label>
        <div className="chips" role="group" aria-label="Filtrar por situação">
          {FILTERS[kind].map((f) => (
            <button
              key={f.value}
              type="button"
              className="chip"
              aria-pressed={filter === f.value}
              data-alert={f.value === 'atrasadas' && counts.atrasadas ? '' : undefined}
              onClick={() => onFilter(f.value)}
            >
              {f.label}
              <span className="chip-count">{counts[f.value]}</span>
            </button>
          ))}
        </div>
      </div>

      {selectedList.length ? (
        <div className="bulkbar" role="region" aria-label="Ações para os lançamentos selecionados">
          <span className="bulkbar-text">
            <strong>
              {selectedList.length} {selectedList.length === 1 ? 'selecionado' : 'selecionados'}
            </strong>{' '}
            {brl2(selectedList.reduce((a, e) => a + e.amount, 0))}
          </span>
          <button type="button" className="btn btn-inverse sm" disabled={!selectedPending.length} onClick={() => onPay(selectedPending)}>
            <Check size={15} aria-hidden="true" />
            {gasto ? 'Marcar como pagos' : 'Marcar como recebidas'}
          </button>
          <button type="button" className="btn btn-inverse sm" onClick={() => onRemove(selectedList)}>
            <Trash2 size={15} aria-hidden="true" />
            Excluir
          </button>
          <button type="button" className="bulkbar-clear" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </button>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="empty">
          <CalendarDays size={22} aria-hidden="true" />
          <p className="empty-title">{gasto ? 'Nenhum gasto' : 'Nenhuma receita'} em {monthTitle}</p>
          <p className="empty-text">
            {gasto ? 'Lance as contas e as compras do mês para acompanhar os vencimentos e o orçamento.' : 'Lance o salário e outras entradas para ver quanto sobra no mês.'}
          </p>
          <button type="button" className="btn btn-primary" onClick={onNew}>
            <Plus size={16} aria-hidden="true" />
            {gasto ? 'Novo gasto' : 'Nova receita'}
          </button>
        </div>
      ) : list.length === 0 ? (
        <div className="empty">
          <SearchX size={22} aria-hidden="true" />
          <p className="empty-title">Nada com esses filtros</p>
          <p className="empty-text">
            {query ? `Nada corresponde a “${query}”` : 'Não há lançamentos nessa situação'}
            {category !== 'todas' ? ` em ${CATEGORIES[category].label.toLowerCase()}` : ''}. Limpe os filtros para ver tudo do mês.
          </p>
          <button type="button" className="btn btn-secondary" onClick={clearFilters}>
            Limpar filtros
          </button>
        </div>
      ) : asCards ? (
        <ul className="ecards">
          {visible.map((e, i) => {
            const Icon = CATEGORY_ICON[e.category];
            return (
              <li key={e.id} style={cssVars({ '--i': Math.min(i, 12) })}>
                <button type="button" className="ecard" onClick={() => onEdit(e)}>
                  <span className="ecard-icon" aria-hidden="true" style={{ color: CATEGORIES[e.category].color }}>
                    <Icon size={17} strokeWidth={1.9} />
                  </span>
                  <span className="ecard-main">
                    <span className="ecard-name">
                      {e.description}
                      {instTag(e)}
                      {e.recurring ? <Repeat size={13} className="ecard-rec" aria-label="Repete todo mês" /> : null}
                    </span>
                    <span className="ecard-sub">
                      {dm(e.dueDate)} <span className="sep" aria-hidden="true" /> {CATEGORIES[e.category].label}
                    </span>
                  </span>
                  <span className="ecard-side">
                    <span className="ecard-amount">{brl2(e.amount)}</span>
                    <ExpenseStatusPill e={e} today={today} short />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="table-wrap">
          <table className="data-table ledger">
            <thead>
              <tr>
                <th scope="col" className="col-check">
                  <input
                    type="checkbox"
                    className="check"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedList.length > 0 && !allSelected;
                    }}
                    onChange={toggleAll}
                    aria-label={allSelected ? 'Desmarcar todos' : 'Selecionar todos os lançamentos da lista'}
                  />
                </th>
                <th scope="col" aria-sort={ariaSort('vencimento')}>
                  <button type="button" className="th-sort" onClick={() => sortBy('vencimento')}>
                    Data {sortIcon('vencimento')}
                  </button>
                </th>
                <th scope="col" aria-sort={ariaSort('descricao')}>
                  <button type="button" className="th-sort" onClick={() => sortBy('descricao')}>
                    Descrição {sortIcon('descricao')}
                  </button>
                </th>
                <th scope="col">Situação</th>
                <th scope="col" className="num" aria-sort={ariaSort('valor')}>
                  <button type="button" className="th-sort" onClick={() => sortBy('valor')}>
                    Valor {sortIcon('valor')}
                  </button>
                </th>
                <th scope="col" className="col-actions">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, i) => {
                const Icon = CATEGORY_ICON[e.category];
                const due = parseIso(e.dueDate);
                return (
                  <tr key={e.id} className="row-click" style={cssVars({ '--i': Math.min(i, 12) })} data-selected={selected.has(e.id) ? '' : undefined} onClick={() => onEdit(e)}>
                    <td className="col-check" onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox" className="check" checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Selecionar ${e.description}`} />
                    </td>
                    <td className="nowrap">
                      <span className="due">{fmtDate.dayMonth(due)}</span>
                      <span className="cust-sub">{WEEKDAYS_SHORT[due.getDay()]}</span>
                    </td>
                    <td className="col-desc">
                      <div className="exp-line">
                        <button
                          type="button"
                          className="exp-name"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onEdit(e);
                          }}
                        >
                          {e.description}
                        </button>
                        {instTag(e)}
                        {e.recurring ? <Repeat size={13} className="exp-rec" aria-label="Repete todo mês" /> : null}
                      </div>
                      <div className="exp-meta">
                        <Icon size={13} aria-hidden="true" style={{ color: CATEGORIES[e.category].color }} />
                        <span>{CATEGORIES[e.category].label}</span>
                        <span className="sep" aria-hidden="true" />
                        <span>{PAY_KINDS[e.method]}</span>
                        {e.supplier ? (
                          <>
                            <span className="sep" aria-hidden="true" />
                            <span>{e.supplier}</span>
                          </>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <ExpenseStatusPill e={e} today={today} />
                    </td>
                    <td className={cx('num', 'strong', !gasto && 'num-pos')}>
                      {gasto ? '' : '+'}
                      {brl2(e.amount)}
                    </td>
                    <td className="col-actions" onClick={(ev) => ev.stopPropagation()}>
                      {!e.paidAt ? (
                        <button type="button" className="btn btn-secondary xs" onClick={() => onPay([e])} aria-label={`${payWord} ${e.description}`}>
                          {payWord}
                        </button>
                      ) : null}
                      <button type="button" className="icon-btn sm row-del" onClick={() => onRemove([e])} aria-label={`Excluir ${e.description}`}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {truncated || (expanded && !filtered) ? (
        <div className="ledger-more">
          <button type="button" className="btn btn-secondary" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? 'Mostrar só os mais urgentes' : `Mostrar todos os ${list.length}`}
            <ChevronDown size={15} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
          </button>
        </div>
      ) : null}

      {list.length ? (
        <div className="ledger-foot">
          <span>{truncated ? `Mostrando ${visible.length} de ${list.length}` : filtered ? `${list.length} de ${stats.count}` : noun(list.length)}</span>
          <span className="ledger-sums">
            <span>
              Total <strong>{brl2(totals.total)}</strong>
            </span>
            <span>
              {gasto ? 'Pagos' : 'Recebidas'} <strong>{brl2(totals.paid)}</strong>
            </span>
            <span>
              {gasto ? 'A pagar' : 'A receber'} <strong>{brl2(totals.pending)}</strong>
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orçamento

function BudgetBlock({
  model,
  all,
  budgets,
  onSave,
  onShowCategory,
}: {
  model: MonthFinance;
  all: Expense[];
  budgets: Budgets;
  onSave: (b: Budgets | null) => void;
  onShowCategory: (c: ExpenseCategory) => void;
}) {
  const toDraft = (b: Budgets) => Object.fromEntries(CATEGORY_ORDER.map((c) => [c, b[c] ? formatBRLInput(b[c]) : ''])) as Record<ExpenseCategory, string>;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<ExpenseCategory, string>>(() => toDraft(budgets));
  const [invalid, setInvalid] = useState<Set<ExpenseCategory>>(() => new Set());
  const totalBudget = CATEGORY_ORDER.reduce((a, c) => a + model.byCategory[c].budget, 0);
  const ratioAll = totalBudget ? model.gastos / totalBudget : 0;
  const leftover = model.revenue - totalBudget;

  const start = () => {
    setDraft(toDraft(budgets));
    setInvalid(new Set());
    setEditing(true);
  };

  const save = () => {
    const bad = new Set<ExpenseCategory>();
    const next = { ...budgets };
    for (const c of CATEGORY_ORDER) {
      const v = draft[c].trim() ? parseBRL(draft[c]) : 0;
      if (v === null) bad.add(c);
      else next[c] = v;
    }
    setInvalid(bad);
    if (bad.size) {
      document.getElementById(`orc-${[...bad][0]}`)?.focus();
      return;
    }
    onSave(next);
    setEditing(false);
  };

  return (
    <div className="block">
      <div className="block-head">
        <div>
          <h2 className="card-title">Orçamento por categoria</h2>
          <p className="block-sub">
            {totalBudget
              ? `${brl0(model.gastos)} de ${brl0(totalBudget)} planejados (${fmt.pct(ratioAll, 0)})`
              : 'Defina quanto quer gastar, no máximo, em cada categoria'}
          </p>
        </div>
        {editing ? null : (
          <button type="button" className="link-btn with-icon" onClick={start}>
            <Pencil size={14} aria-hidden="true" />
            {totalBudget ? 'Editar limites' : 'Definir limites'}
          </button>
        )}
      </div>

      <ul className="budgets">
        {CATEGORY_ORDER.map((c, i) => {
          const t = model.byCategory[c];
          const Icon = CATEGORY_ICON[c];
          const ratio = t.budget ? t.total / t.budget : t.total ? Infinity : 0;
          const tone: Tone = !t.budget ? 'neutral' : ratio > 1 ? 'critical' : ratio >= 0.9 ? 'warning' : 'good';
          const scaleMax = Math.max(t.budget, t.total) || 1;
          const StateIcon = tone === 'critical' ? TriangleAlert : tone === 'warning' ? Clock : CircleCheck;
          const stateText = !t.budget
            ? 'Sem limite definido'
            : tone === 'critical'
              ? `Passou do limite em ${brl0(t.total - t.budget)}`
              : tone === 'warning'
                ? `Perto do limite, restam ${brl0(t.budget - t.total)}`
                : `Dentro do limite, restam ${brl0(t.budget - t.total)}`;
          return (
            <li key={c} className="budget" style={cssVars({ '--i': i })}>
              <span className="budget-icon" aria-hidden="true" style={{ color: CATEGORIES[c].color }}>
                <Icon size={17} strokeWidth={1.9} />
              </span>
              <div className="budget-main">
                <div className="budget-top">
                  <button type="button" className="budget-name" onClick={() => onShowCategory(c)} title={`Ver os gastos de ${CATEGORIES[c].label.toLowerCase()}`}>
                    {CATEGORIES[c].label}
                  </button>
                  {editing ? (
                    <span className="input-money budget-input" data-invalid={invalid.has(c) ? '' : undefined}>
                      <span aria-hidden="true">R$</span>
                      <input
                        id={`orc-${c}`}
                        className="input"
                        inputMode="decimal"
                        value={draft[c]}
                        placeholder="sem limite"
                        aria-label={`Limite de ${CATEGORIES[c].label}`}
                        aria-invalid={invalid.has(c) || undefined}
                        onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))}
                        onBlur={(e) => {
                          const v = parseBRL(e.target.value);
                          if (v !== null) setDraft((d) => ({ ...d, [c]: formatBRLInput(v) }));
                        }}
                      />
                    </span>
                  ) : (
                    <span className="budget-amounts">
                      <strong>{brl0(t.total)}</strong>
                      {t.budget ? ` de ${brl0(t.budget)}` : ''}
                    </span>
                  )}
                </div>
                {editing ? (
                  <span className="budget-hint">
                    {CATEGORIES[c].hint}. Gasto em {monthName(model.key).toLowerCase()}: {brl0(t.total)}
                  </span>
                ) : (
                  <>
                    <div
                      className="meter"
                      data-tone={tone}
                      role="meter"
                      aria-label={`${CATEGORIES[c].label}: ${t.budget ? fmt.pct(ratio, 0) : 'sem limite'}`}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(scaleMax)}
                      aria-valuenow={Math.round(t.total)}
                    >
                      <span className="meter-fill" style={{ width: `${(t.total / scaleMax) * 100}%` }} />
                      {t.budget && t.total > t.budget ? <span className="meter-mark" style={{ left: `${(t.budget / scaleMax) * 100}%` }} /> : null}
                    </div>
                    <div className="budget-foot">
                      <span className="budget-state" data-tone={tone}>
                        <StateIcon size={13} strokeWidth={2.2} aria-hidden="true" />
                        {stateText}
                      </span>
                      <span className="budget-pct">{t.budget ? fmt.pct(ratio, 0) : ''}</span>
                    </div>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {editing ? (
        <div className="block-actions">
          <button type="button" className="link-btn" onClick={() => setDraft(toDraft(suggestBudgets(all, model.key)))} title="Média dos últimos 3 meses, arredondada">
            Sugerir pela média
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            Salvar limites
          </button>
        </div>
      ) : (
        <p className="block-note">
          {totalBudget && model.revenue
            ? leftover >= 0
              ? `Respeitando todos os limites, sobram ${brl0(leftover)} da renda deste mês. `
              : `Os limites somam ${brl0(-leftover)} a mais do que a renda deste mês. `
            : ''}
          Os limites valem para todos os meses. Clique numa categoria para ver os gastos dela.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resumo do mês

const GROUP_HINT: Record<string, string> = {
  receitas: 'Salário, renda extra e rendimentos',
  fixos: 'O que repete todo mês e as parcelas de compras',
  variaveis: 'Mercado, transporte, lazer e outros gastos avulsos',
};

function SummaryBlock({ model, onShowCategory }: { model: MonthFinance; onShowCategory: (c: Category, k: EntryKind) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(['receitas']));
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const showPrev = width === 0 || width >= 560;
  const rev = model.revenue;
  const groups = model.summary.filter((r) => r.kind === 'group').map((r) => r.id);
  const allOpen = groups.every((g) => open.has(g));
  const share = (v: number) => (rev ? fmt.pct(Math.abs(v) / rev) : '—');
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const prevName = monthName(addMonths(model.key, -1));
  return (
    <div className="block" ref={boxRef}>
      <div className="block-head">
        <div>
          <h2 className="card-title">Resumo do mês</h2>
          <p className="block-sub">O que entrou e o que saiu, por categoria</p>
        </div>
        <button type="button" className="link-btn" onClick={() => setOpen(allOpen ? new Set() : new Set(groups))}>
          {allOpen ? 'Fechar detalhes' : 'Abrir detalhes'}
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table dre">
          <thead>
            <tr>
              <th scope="col">Conta</th>
              <th scope="col" className="num">
                {monthName(model.key)}
              </th>
              <th scope="col" className="num">
                % da renda
              </th>
              {showPrev ? (
                <th scope="col" className="num">
                  {prevName}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {model.summary.map((r) => {
              const isOpen = open.has(r.id);
              const final = r.id === 'lucro';
              return (
                <Fragment key={r.id}>
                  <tr data-kind={r.kind} data-final={final ? '' : undefined}>
                    <th scope="row">
                      {r.kind === 'group' ? (
                        <button type="button" className="dre-toggle" aria-expanded={isOpen} onClick={() => toggle(r.id)} disabled={!r.children?.length}>
                          <ChevronRight size={15} aria-hidden="true" />
                          {r.label}
                        </button>
                      ) : (
                        <span>{r.label}</span>
                      )}
                      {final && r.value < 0 && rev ? (
                        <span className="status" data-tone="critical">
                          <TriangleAlert size={13} aria-hidden="true" />
                          No vermelho
                        </span>
                      ) : null}
                      {GROUP_HINT[r.id] ? <span className="dre-hint">{GROUP_HINT[r.id]}</span> : null}
                    </th>
                    <td className={cx('num', final && r.value < 0 && 'num-neg')}>{brl2(r.value)}</td>
                    <td className="num muted">{(final && r.value < -0.5 ? MINUS : '') + share(r.value)}</td>
                    {showPrev ? <td className="num muted">{model.prev ? brl0(r.prev) : '—'}</td> : null}
                  </tr>
                  {r.kind === 'group' && isOpen
                    ? r.children?.map((c) => (
                        <tr key={c.id} data-kind="child">
                          <th scope="row">
                            <span>{c.label}</span>
                            {c.category && c.count ? (
                              <button type="button" className="link-btn dre-link" onClick={() => onShowCategory(c.category!, c.entryKind!)}>
                                {plural(c.count, 'lançamento', 'lançamentos')}
                              </button>
                            ) : null}
                          </th>
                          <td className="num">{brl2(c.value)}</td>
                          <td className="num muted">{share(c.value)}</td>
                          {showPrev ? <td className="num muted">{model.prev ? brl0(c.prev) : '—'}</td> : null}
                        </tr>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="block-note">Contas fixas são os lançamentos marcados como “repete todo mês”. Clique em “lançamentos” para ver a lista de cada categoria.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulário de lançamento

interface Draft {
  kind: EntryKind;
  description: string;
  amount: string;
  category: Category | '';
  supplier: string;
  dueDate: string;
  competence: MonthKey;
  paid: boolean;
  paidAt: string;
  method: PayKind;
  recurring: boolean;
  installments: number;
  notes: string;
}
type DraftField = 'description' | 'amount' | 'category' | 'dueDate' | 'paidAt';

function initialDraft(state: EditorState, month: MonthKey, today: string): Draft {
  const e = state.expense;
  if (!e) {
    const current = today.slice(0, 7) === month;
    const dueDate = current ? today : `${month}-${today.slice(8, 10) > '28' ? '28' : today.slice(8, 10)}`;
    return {
      kind: state.kind,
      description: '',
      amount: '',
      category: '',
      supplier: '',
      dueDate,
      competence: month,
      paid: dueDate <= today,
      paidAt: dueDate <= today ? dueDate : today,
      method: state.kind === 'receita' ? 'transferencia' : 'pix',
      recurring: false,
      installments: 1,
      notes: '',
    };
  }
  const dup = state.mode === 'duplicar';
  return {
    kind: e.kind,
    description: e.description,
    amount: formatBRLInput(e.amount),
    category: e.category,
    supplier: e.supplier,
    dueDate: e.dueDate,
    competence: dup ? month : e.competence,
    paid: dup ? false : !!e.paidAt,
    paidAt: (!dup && e.paidAt) || today,
    method: e.method,
    recurring: e.recurring,
    installments: 1,
    notes: e.notes,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INSTALLMENT_OPTIONS = Array.from({ length: 23 }, (_, i) => i + 2);

function ExpenseDrawer({
  state,
  month,
  months,
  today,
  all,
  onClose,
  onSubmit,
  onDelete,
  onDuplicate,
  leaving,
}: {
  state: EditorState;
  leaving?: boolean;
  month: MonthKey;
  months: MonthKey[];
  today: string;
  all: Expense[];
  onClose: () => void;
  onSubmit: (list: Expense[], mode: EditorMode) => void;
  onDelete: (e: Expense) => void;
  onDuplicate: (e: Expense) => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const firstRef = useRef<HTMLInputElement | null>(null);
  const initial = useMemo(() => initialDraft(state, month, today), [state, month, today]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const touched = useRef({ category: !!initial.category, paid: state.mode === 'editar', competence: false });
  useBodyLock(true);
  useFocusTrap(true, panelRef, firstRef);

  const editing = state.mode === 'editar' ? state.expense! : null;
  const gasto = draft.kind === 'gasto';
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const competenceOptions = useMemo(() => {
    const set = new Set(months);
    for (let i = -1; i <= 2; i++) set.add(addMonths(draft.dueDate.slice(0, 7), i));
    set.add(draft.competence);
    return [...set].sort();
  }, [months, draft.dueDate, draft.competence]);
  const canSplit = !editing && gasto && !draft.recurring;
  const installments = canSplit ? draft.installments : 1;

  // Descrições já usadas: sugere e preenche categoria, forma de pagamento e local.
  const previous = useMemo(() => {
    const m = new Map<string, Expense>();
    for (const e of [...all].sort((a, b) => b.dueDate.localeCompare(a.dueDate))) {
      const k = normalize(e.description);
      if (e.kind === draft.kind && !m.has(k)) m.set(k, e);
    }
    return m;
  }, [all, draft.kind]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key as DraftField]) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const setKind = (k: EntryKind) => {
    touched.current.category = false;
    setDraft((d) => ({
      ...d,
      kind: k,
      category: d.category && CATEGORIES[d.category].kind === k ? d.category : '',
      method: k === 'receita' && d.method === 'cartao' ? 'transferencia' : d.method,
    }));
  };

  const setDescription = (v: string) => {
    const match = editing ? undefined : previous.get(normalize(v.trim()));
    setDraft((d) =>
      match
        ? {
            ...d,
            description: v,
            category: touched.current.category ? d.category : match.category,
            method: match.method,
            supplier: d.supplier || match.supplier,
            amount: d.amount || formatBRLInput(match.amount),
            recurring: d.recurring || match.recurring,
          }
        : { ...d, description: v },
    );
    if (errors.description) setErrors((er) => ({ ...er, description: undefined }));
  };

  const setDue = (v: string) => {
    setDraft((d) => ({
      ...d,
      dueDate: v,
      competence: !touched.current.competence && DATE_RE.test(v) ? v.slice(0, 7) : d.competence,
      paid: touched.current.paid ? d.paid : v <= today,
      paidAt: touched.current.paid || v > today ? d.paidAt : v,
    }));
    if (errors.dueDate) setErrors((er) => ({ ...er, dueDate: undefined }));
  };

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const errs: Partial<Record<DraftField, string>> = {};
    const description = draft.description.trim();
    const amount = parseBRL(draft.amount);
    if (!description) errs.description = gasto ? 'Dê um nome ao gasto, como “Mercado” ou “Aluguel”.' : 'Dê um nome à receita, como “Salário”.';
    if (amount === null || amount <= 0) errs.amount = 'Informe um valor maior que zero, como 150,00.';
    if (!draft.category) errs.category = 'Escolha a categoria.';
    if (!DATE_RE.test(draft.dueDate)) errs.dueDate = 'Informe a data.';
    if (draft.paid && !DATE_RE.test(draft.paidAt)) errs.paidAt = gasto ? 'Informe quando foi pago.' : 'Informe quando foi recebido.';
    setErrors(errs);
    const first = (['amount', 'description', 'category', 'dueDate', 'paidAt'] as DraftField[]).find((k) => errs[k]);
    if (first) {
      document.getElementById(`desp-${first}`)?.focus();
      return;
    }
    const source = state.expense;
    const id = editing ? editing.id : newExpenseId();
    const seriesId = draft.recurring ? (source?.seriesId ?? id) : (editing?.seriesId ?? null);
    const base: Expense = {
      id,
      kind: draft.kind,
      description: description.slice(0, 120),
      category: draft.category as Category,
      amount: amount!,
      competence: draft.competence,
      dueDate: draft.dueDate,
      paidAt: draft.paid ? draft.paidAt : null,
      method: draft.method,
      supplier: draft.supplier.trim().slice(0, 80),
      notes: draft.notes.trim().slice(0, 280),
      recurring: draft.recurring,
      seriesId,
      installment: editing?.installment ?? null,
    };
    onSubmit(installments > 1 ? splitInstallments(base, installments, newExpenseId) : [base], state.mode);
  };

  const err = (k: DraftField) =>
    errors[k] ? (
      <span className="field-error" id={`desp-${k}-erro`}>
        <TriangleAlert size={13} aria-hidden="true" />
        {errors[k]}
      </span>
    ) : null;

  const noun = gasto ? 'gasto' : 'receita';
  const title = state.mode === 'editar' ? `Editar ${noun}` : state.mode === 'duplicar' ? `Duplicar ${noun}` : gasto ? 'Novo gasto' : 'Nova receita';
  const amountValue = parseBRL(draft.amount) ?? 0;

  return (
    <div className="overlay-root" data-leaving={leaving ? '' : undefined}>
      <div className="scrim" onClick={requestClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className="drawer drawer-form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="despesa-titulo"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            requestClose();
          }
        }}
      >
        <header className="drawer-head">
          <div>
            <p className="drawer-kicker">
              {monthLabel(draft.competence)}
              {editing?.installment ? `, parcela ${editing.installment.n} de ${editing.installment.total}` : ''}
            </p>
            <h2 id="despesa-titulo" className="drawer-title">
              {title}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={requestClose} aria-label="Fechar formulário">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <form id="form-despesa" className="drawer-body form" onSubmit={submit} noValidate>
          <Segmented
            id="form-tipo"
            label="Tipo"
            value={draft.kind}
            options={[
              { value: 'gasto', label: 'Gasto' },
              { value: 'receita', label: 'Receita' },
            ]}
            onChange={setKind}
          />

          <div className="field-row">
            <div className="field">
              <label htmlFor="desp-amount">{installments > 1 ? 'Valor total da compra' : 'Valor'}</label>
              <span className="input-money">
                <span aria-hidden="true">R$</span>
                <input
                  ref={firstRef}
                  id="desp-amount"
                  className="input"
                  inputMode="decimal"
                  value={draft.amount}
                  placeholder="0,00"
                  autoComplete="off"
                  aria-invalid={!!errors.amount || undefined}
                  aria-describedby={errors.amount ? 'desp-amount-erro' : undefined}
                  onChange={(e) => set('amount', e.target.value)}
                  onBlur={(e) => {
                    const v = parseBRL(e.target.value);
                    if (v !== null) set('amount', formatBRLInput(v));
                  }}
                />
              </span>
              {err('amount')}
            </div>
            <div className="field">
              <label htmlFor="desp-dueDate">{gasto ? 'Data ou vencimento' : 'Data'}</label>
              <input
                id="desp-dueDate"
                type="date"
                className="input"
                value={draft.dueDate}
                aria-invalid={!!errors.dueDate || undefined}
                aria-describedby={errors.dueDate ? 'desp-dueDate-erro' : undefined}
                onChange={(e) => setDue(e.target.value)}
              />
              {err('dueDate')}
            </div>
          </div>

          <div className="field">
            <label htmlFor="desp-description">Descrição</label>
            <input
              id="desp-description"
              className="input"
              list="desp-sugestoes"
              value={draft.description}
              maxLength={120}
              placeholder={gasto ? 'Ex.: Mercado, Aluguel, Uber' : 'Ex.: Salário, Freela'}
              autoComplete="off"
              aria-invalid={!!errors.description || undefined}
              aria-describedby={errors.description ? 'desp-description-erro' : undefined}
              onChange={(e) => setDescription(e.target.value)}
            />
            <datalist id="desp-sugestoes">
              {[...previous.values()].slice(0, 80).map((e) => (
                <option key={e.id} value={e.description} />
              ))}
            </datalist>
            {err('description')}
          </div>

          <fieldset className="field" aria-describedby={errors.category ? 'desp-category-erro' : undefined}>
            <legend>Categoria</legend>
            <div className="cat-grid">
              {categoriesOf(draft.kind).map((c, i) => {
                const Icon = CATEGORY_ICON[c];
                return (
                  <label key={c} className="cat-opt" title={CATEGORIES[c].hint}>
                    <input
                      id={i === 0 ? 'desp-category' : undefined}
                      type="radio"
                      name="categoria"
                      value={c}
                      checked={draft.category === c}
                      onChange={() => {
                        touched.current.category = true;
                        set('category', c);
                      }}
                    />
                    <span>
                      <Icon size={16} strokeWidth={1.9} aria-hidden="true" style={{ color: CATEGORIES[c].color }} />
                      {CATEGORIES[c].label}
                    </span>
                  </label>
                );
              })}
            </div>
            {err('category')}
          </fieldset>

          <div className="field-row">
            <div className="field">
              <label htmlFor="desp-method">{gasto ? 'Forma de pagamento' : 'Como entrou'}</label>
              <span className="select field-select">
                <select id="desp-method" className="input" value={draft.method} onChange={(e) => set('method', e.target.value as PayKind)}>
                  {PAY_KIND_ORDER.filter((k) => gasto || k !== 'cartao').map((k) => (
                    <option key={k} value={k}>
                      {PAY_KINDS[k]}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            {canSplit ? (
              <div className="field">
                <label htmlFor="desp-installments">Parcelas</label>
                <span className="select field-select">
                  <select id="desp-installments" className="input" value={draft.installments} onChange={(e) => set('installments', Number(e.target.value))}>
                    <option value={1}>À vista</option>
                    {INSTALLMENT_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}x
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="desp-competence">Conta no mês de</label>
                <span className="select field-select">
                  <select
                    id="desp-competence"
                    className="input"
                    value={draft.competence}
                    onChange={(e) => {
                      touched.current.competence = true;
                      set('competence', e.target.value);
                    }}
                  >
                    {competenceOptions.map((k) => (
                      <option key={k} value={k}>
                        {monthLabel(k)}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            )}
          </div>
          {installments > 1 ? (
            <p className="field-hint form-hint">
              {installments}x de {fmt.brl2(Math.floor((amountValue / installments) * 100) / 100)}, uma em cada mês a partir de {monthLabel(draft.competence)}. A primeira fica com
              os centavos que sobrarem.
            </p>
          ) : canSplit ? null : (
            <p className="field-hint form-hint">Para compras no cartão, escolha o mês da fatura.</p>
          )}

          <div className="field">
            <label htmlFor="desp-supplier">
              {gasto ? 'Onde' : 'De quem'} <span className="opt">(opcional)</span>
            </label>
            <input
              id="desp-supplier"
              className="input"
              value={draft.supplier}
              maxLength={80}
              autoComplete="off"
              placeholder={gasto ? 'Loja, empresa ou pessoa' : 'Empresa, cliente ou pessoa'}
              onChange={(e) => set('supplier', e.target.value)}
            />
          </div>

          <div className="switch-row">
            <span className="switch">
              <input
                id="desp-paid"
                type="checkbox"
                role="switch"
                checked={draft.paid}
                onChange={(e) => {
                  touched.current.paid = true;
                  set('paid', e.target.checked);
                }}
              />
              <span className="switch-track" aria-hidden="true" />
            </span>
            <label htmlFor="desp-paid" className="switch-text">
              <strong>{gasto ? 'Já paguei' : 'Já recebi'}</strong>
              <span>{gasto ? 'Deixe desligado para contas que ainda vão vencer.' : 'Deixe desligado se o dinheiro ainda não entrou.'}</span>
            </label>
          </div>
          {draft.paid ? (
            <div className="field field-indent">
              <label htmlFor="desp-paidAt">{gasto ? 'Pago em' : 'Recebido em'}</label>
              <input
                id="desp-paidAt"
                type="date"
                className="input"
                value={draft.paidAt}
                aria-invalid={!!errors.paidAt || undefined}
                aria-describedby={errors.paidAt ? 'desp-paidAt-erro' : undefined}
                onChange={(e) => set('paidAt', e.target.value)}
              />
              {err('paidAt')}
            </div>
          ) : null}

          <div className="switch-row">
            <span className="switch">
              <input id="desp-recurring" type="checkbox" role="switch" checked={draft.recurring} onChange={(e) => set('recurring', e.target.checked)} />
              <span className="switch-track" aria-hidden="true" />
            </span>
            <label htmlFor="desp-recurring" className="switch-text">
              <strong>Repete todo mês</strong>
              <span>{gasto ? 'Aluguel, contas, assinaturas.' : 'Salário, mesada, aluguel recebido.'} Se faltar no mês seguinte, o painel avisa para lançar.</span>
            </label>
          </div>

          <div className="field">
            <label htmlFor="desp-notes">
              Observação <span className="opt">(opcional)</span>
            </label>
            <textarea
              id="desp-notes"
              className="input"
              rows={2}
              maxLength={280}
              value={draft.notes}
              placeholder="Algo que queira lembrar"
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
        </form>

        <footer className="drawer-foot form-foot">
          {confirmDiscard ? (
            <div className="discard" role="alert">
              <p>Descartar o que você preencheu?</p>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmDiscard(false)}>
                Continuar editando
              </button>
              <button type="button" className="btn btn-danger" onClick={onClose}>
                Descartar
              </button>
            </div>
          ) : (
            <>
              {editing ? (
                <div className="form-foot-left">
                  <button type="button" className="btn btn-danger" onClick={() => onDelete(editing)}>
                    <Trash2 size={15} aria-hidden="true" />
                    Excluir
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => onDuplicate(editing)}>
                    <CopyPlus size={15} aria-hidden="true" />
                    Duplicar
                  </button>
                </div>
              ) : null}
              <div className="form-foot-right">
                <button type="button" className="btn btn-secondary" onClick={requestClose}>
                  Cancelar
                </button>
                <button type="submit" form="form-despesa" className="btn btn-primary">
                  {editing ? 'Salvar alterações' : installments > 1 ? `Lançar ${installments} parcelas` : gasto ? 'Lançar gasto' : 'Lançar receita'}
                </button>
              </div>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
