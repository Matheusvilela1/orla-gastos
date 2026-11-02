import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Banknote,
  CalendarCheck,
  CircleCheck,
  Coins,
  Crown,
  Flag,
  Flame,
  Footprints,
  Gauge,
  Gem,
  Infinity as InfinityIcon,
  Landmark,
  Lock,
  Medal,
  Pencil,
  PiggyBank,
  Plus,
  Repeat,
  Shapes,
  ShieldCheck,
  Sprout,
  Star,
  Target,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Trophy,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ACHIEVEMENT_GROUPS, buildAchievements, buildMilestones, type Achievement } from '../lib/conquistas';
import { formatBRLInput, isoDate, parseBRL, parseIso } from '../lib/finance';
import { useFinance } from '../lib/financeStore';
import { fmt, fmtDate } from '../lib/format';
import { useBodyLock, useCountUp, useFocusTrap } from '../lib/hooks';
import { buildPortfolio, type Portfolio } from '../lib/invest';
import { GOAL_SOURCES, goalCurrent, newGoalId, type Goal, type GoalSource } from '../lib/metas';
import { usePresence, useRevealOnScroll } from '../lib/motion';
import { Poster } from './poster';
import { useToast } from './toast';
import { Segmented, cssVars } from './ui';

const ICONS: Record<string, LucideIcon> = {
  'primeiro-passo': Footprints,
  'no-azul': CircleCheck,
  'tres-no-azul': Flame,
  'semestre-no-azul': Medal,
  'ano-no-azul': Crown,
  'guardou-10': PiggyBank,
  'guardou-30': Gem,
  'contas-em-dia': CalendarCheck,
  'dentro-do-orcamento': Gauge,
  'primeiro-investimento': Sprout,
  'investiu-1000': Coins,
  'investiu-10000': Banknote,
  'investiu-50000': Landmark,
  'investiu-100000': Trophy,
  'dinheiro-trabalhando': TrendingUp,
  'carteira-variada': Shapes,
  constancia: Repeat,
  'constancia-6': InfinityIcon,
  reserva: ShieldCheck,
  'primeira-meta': Target,
  'meta-batida': Flag,
  'tres-metas': Star,
};

const brl = (v: number) => fmt.brl2(v);
const dmy = (iso: string) => fmtDate.dayMonthYear(parseIso(iso));
const two = (n: number) => String(n).padStart(2, '0');

/** Meses inteiros entre hoje e o prazo (pelo menos 1). */
const monthsUntil = (today: string, deadline: string) => {
  const a = parseIso(today);
  const b = parseIso(deadline);
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() > a.getDate() ? 1 : 0));
};

type GoalEditor = { mode: 'novo' } | { mode: 'editar'; goal: Goal };

// ---------------------------------------------------------------------------
// Filtros com sublinhado que desliza até a opção escolhida

function UnderlineTabs<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = boxRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (el) setBar({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value, options.length]);
  return (
    <div ref={boxRef} className="utabs" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="utab" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined ? <span className="utab-count">{o.count}</span> : null}
        </button>
      ))}
      {bar ? <span className="utabs-bar" style={cssVars({ '--x': `${bar.x}px`, '--w': `${bar.w}px` })} aria-hidden="true" /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Louros desenhados (um ramo; o outro lado é espelhado)

function Laurel({ side }: { side: 'left' | 'right' }) {
  const leaves = Array.from({ length: 7 }, (_, i) => {
    const t = 0.12 + i * 0.13;
    // Curva do ramo: de baixo (40,118) até em cima (34,6), puxando para a esquerda
    const x = (1 - t) ** 2 * 40 + 2 * (1 - t) * t * 4 + t * t * 34;
    const y = (1 - t) ** 2 * 118 + 2 * (1 - t) * t * 66 + t * t * 6;
    const dx = 2 * (1 - t) * (4 - 40) + 2 * t * (34 - 4);
    const dy = 2 * (1 - t) * (66 - 118) + 2 * t * (6 - 66);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    return { x, y, angle, i };
  });
  return (
    <svg className="laurel" data-side={side} viewBox="0 0 50 124" aria-hidden="true">
      <path d="M40 118 Q4 66 34 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      {leaves.map((l) => (
        <g key={l.i} transform={`translate(${l.x} ${l.y}) rotate(${l.angle})`}>
          <ellipse className="laurel-leaf" style={cssVars({ '--i': l.i })} cx={-7} cy={-3} rx={8.5} ry={3.6} transform="rotate(-32)" fill="currentColor" />
          <ellipse className="laurel-leaf" style={cssVars({ '--i': l.i + 0.5 })} cx={7} cy={-3} rx={8.5} ry={3.6} transform="rotate(32)" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

function AwardCount({ unlocked, total, next }: { unlocked: number; total: number; next: Achievement | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((x) => x.isIntersecting)) return;
        setSeen(true);
        io.disconnect();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const shown = useCountUp(seen ? unlocked : 0, 1400);
  return (
    <div ref={ref} className="award" data-in={seen ? '' : undefined}>
      <div className="award-figure">
        <Laurel side="left" />
        <p className="award-number" aria-label={`${unlocked} de ${total} conquistas`}>
          <span aria-hidden="true">{Math.round(shown)}</span>
        </p>
        <Laurel side="right" />
      </div>
      <p className="award-label">{unlocked === 1 ? 'conquista desbloqueada' : 'conquistas desbloqueadas'}</p>
      <p className="award-sub">
        de {total} no total.{' '}
        {next ? (
          <>
            A mais perto é <strong>{next.title}</strong>: {next.progressText.toLowerCase()}.
          </>
        ) : (
          'Você desbloqueou todas!'
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tela

type CardFilter = 'todas' | 'feitas' | 'andamento';
type LineFilter = 'tudo' | 'metas' | 'conquistas' | 'marcos';

interface LineItem {
  id: string;
  kind: 'meta' | 'conquista' | 'marco';
  date: string | null;
  title: string;
  desc: string;
  goal?: Goal;
  icon: LucideIcon;
}

export function ConquistasView({ now }: { now: Date }) {
  const fin = useFinance();
  const toast = useToast();
  const today = isoDate(now);
  const portfolio = useMemo(() => buildPortfolio(fin.invest.list, today, fin.invest.cdi), [fin.invest, today]);
  const achievements = useMemo(() => buildAchievements(fin.expenses, fin.budgets, fin.invest, fin.goals, today), [fin.expenses, fin.budgets, fin.invest, fin.goals, today]);
  const milestones = useMemo(() => buildMilestones(fin.expenses, fin.invest, today), [fin.expenses, fin.invest, today]);
  const unlocked = achievements.filter((a) => a.done);
  const next = achievements.filter((a) => !a.done).sort((a, b) => b.progress - a.progress)[0] ?? null;

  const [cardFilter, setCardFilter] = useState<CardFilter>('todas');
  const [lineFilter, setLineFilter] = useState<LineFilter>('tudo');
  const [editor, setEditor] = useState<(GoalEditor & { nonce: number }) | null>(null);
  const [shownEditor, leaving] = usePresence(editor, 240);
  const nonce = useRef(0);
  const cardsRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<HTMLOListElement | null>(null);

  const cards = achievements.filter((a) => (cardFilter === 'feitas' ? a.done : cardFilter === 'andamento' ? !a.done : true));

  const line = useMemo(() => {
    const items: LineItem[] = [
      ...milestones.map((m) => ({ id: m.id, kind: 'marco' as const, date: m.date, title: m.title, desc: m.desc, icon: Flag })),
      ...unlocked.map((a) => ({ id: a.id, kind: 'conquista' as const, date: a.date ?? today, title: a.title, desc: a.desc, icon: ICONS[a.id] ?? Trophy })),
      ...fin.goals.map((g) => ({ id: g.id, kind: 'meta' as const, date: g.deadline, title: g.name, desc: '', goal: g, icon: Target })),
    ].filter((x) => lineFilter === 'tudo' || (lineFilter === 'metas' ? x.kind === 'meta' : lineFilter === 'conquistas' ? x.kind === 'conquista' : x.kind === 'marco'));
    const order = (x: LineItem) => (x.date ?? '9999-99-99') + (x.kind === 'marco' ? 0 : x.kind === 'conquista' ? 1 : 2);
    items.sort((a, b) => order(a).localeCompare(order(b)));
    const past = items.filter((x) => x.date && x.date <= today);
    const future = items.filter((x) => !x.date || x.date > today);
    return { past, future };
  }, [milestones, unlocked, fin.goals, lineFilter, today]);

  useRevealOnScroll(cardsRef, '.ach', [cards.length, cardFilter]);
  useRevealOnScroll(lineRef, '.tl-item, .tl-today', [line.past.length, line.future.length, lineFilter]);

  const openGoal = (e: GoalEditor) => setEditor({ ...e, nonce: ++nonce.current });

  const commitGoals = (next: Goal[], message: string) => {
    const previous = fin.saveGoals(next);
    toast(message, 'success', { action: { label: 'Desfazer', run: () => fin.saveGoals(previous) } });
  };

  const saveGoal = (g: Goal) => {
    const exists = fin.goals.some((x) => x.id === g.id);
    commitGoals(exists ? fin.goals.map((x) => (x.id === g.id ? g : x)) : [...fin.goals, g], exists ? 'Meta atualizada' : `Meta “${g.name}” criada`);
    setEditor(null);
  };

  const removeGoal = (g: Goal) => {
    commitGoals(
      fin.goals.filter((x) => x.id !== g.id),
      `Meta “${g.name}” excluída`,
    );
    setEditor(null);
  };

  let n = 0;
  const renderItem = (x: LineItem) => {
    n++;
    const current = x.goal ? goalCurrent(x.goal, portfolio) : 0;
    const ratio = x.goal ? Math.min(1, current / x.goal.target) : 1;
    const goalDone = x.goal ? ratio >= 1 - 1e-9 : false;
    const late = x.goal && !goalDone && x.goal.deadline && x.goal.deadline < today;
    const perMonth = x.goal && !goalDone && x.goal.deadline && x.goal.deadline > today ? (x.goal.target - current) / monthsUntil(today, x.goal.deadline) : null;
    return (
      <li key={x.id} className="tl-item" data-kind={x.kind} data-done={x.kind !== 'meta' || goalDone ? '' : undefined}>
        <span className="tl-dot" aria-hidden="true">
          <x.icon size={14} strokeWidth={2.2} />
        </span>
        <div className="tl-card">
          <div className="tl-top">
            <span className="tl-num">{two(n)}</span>
            <span className="tl-kind">{x.kind === 'meta' ? 'Meta' : x.kind === 'conquista' ? 'Conquista' : 'Marco'}</span>
            <span className="tl-date">{x.date ? dmy(x.date) : 'Sem prazo'}</span>
          </div>
          <h3 className="tl-title">{x.title}</h3>
          {x.goal ? (
            <>
              <p className="tl-desc">
                {brl(Math.min(current, x.goal.target))} de {brl(x.goal.target)} · {GOAL_SOURCES[x.goal.source].toLowerCase()}
              </p>
              <div className="tl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={`Progresso de ${x.goal.name}`}>
                <span style={cssVars({ '--p': ratio })} />
              </div>
              <p className="tl-note" data-tone={goalDone ? 'good' : late ? 'bad' : undefined}>
                {goalDone
                  ? 'Meta batida!'
                  : late
                    ? `O prazo passou. Faltam ${brl(x.goal.target - current)}.`
                    : perMonth !== null
                      ? `${fmt.pct(ratio, 0)} do caminho. Guardando ${brl(perMonth)} por mês você chega lá (sem contar rendimento).`
                      : `${fmt.pct(ratio, 0)} do caminho. Faltam ${brl(x.goal.target - current)}.`}
              </p>
              <div className="tl-actions">
                <button type="button" className="btn btn-secondary sm" onClick={() => openGoal({ mode: 'editar', goal: x.goal! })}>
                  <Pencil size={14} aria-hidden="true" />
                  {x.goal.source === 'manual' ? 'Atualizar ou editar' : 'Editar'}
                </button>
              </div>
            </>
          ) : (
            <p className="tl-desc">{x.desc}</p>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <Poster kicker="Conquistas" lines={[{ text: 'Seu esforço.' }, { text: 'Suas conquistas.', accent: true }]} sub="O que você já alcançou com o seu dinheiro, calculado pelos seus lançamentos e investimentos." />

      <div className="grid data-grid ach-grid">
        <section className="sheet sheet-solo ach-hero" aria-label="Resumo das conquistas">
          <AwardCount unlocked={unlocked.length} total={achievements.length} next={next} />
        </section>

        <section className="sheet sheet-solo" aria-labelledby="ach-titulo">
          <div className="block">
            <div className="block-head">
              <div>
                <h2 className="card-title" id="ach-titulo">
                  Todas as conquistas
                </h2>
                <p className="block-sub">Meses só contam depois de fechados. Conquistas sem data exata aparecem com a data de hoje.</p>
              </div>
            </div>
            <UnderlineTabs
              label="Mostrar conquistas"
              value={cardFilter}
              onChange={setCardFilter}
              options={[
                { value: 'todas', label: 'Todas', count: achievements.length },
                { value: 'feitas', label: 'Desbloqueadas', count: unlocked.length },
                { value: 'andamento', label: 'Em andamento', count: achievements.length - unlocked.length },
              ]}
            />
            <div className="ach-list" ref={cardsRef}>
              {cards.map((a, i) => {
                const Icon = ICONS[a.id] ?? Trophy;
                return (
                  <article key={a.id} className="ach" data-done={a.done ? '' : undefined} style={cssVars({ '--i': i % 6 })}>
                    <span className="ach-icon" aria-hidden="true">
                      <Icon size={20} strokeWidth={1.9} />
                      {!a.done ? (
                        <span className="ach-lock">
                          <Lock size={10} strokeWidth={2.6} />
                        </span>
                      ) : null}
                    </span>
                    <div className="ach-text">
                      <span className="ach-group">{ACHIEVEMENT_GROUPS[a.group]}</span>
                      <h3 className="ach-title">{a.title}</h3>
                      <p className="ach-desc">{a.desc}</p>
                      {a.done ? (
                        <p className="ach-when">
                          <CircleCheck size={13} aria-hidden="true" />
                          {a.date ? `Alcançada em ${dmy(a.date)}` : 'Alcançada'}
                        </p>
                      ) : (
                        <>
                          <div className="ach-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.progress * 100)} aria-label={`Progresso de ${a.title}`}>
                            <span style={cssVars({ '--p': a.progress })} />
                          </div>
                          <p className="ach-progress">{a.progressText}</p>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
              {!cards.length ? <p className="ach-empty">{cardFilter === 'feitas' ? 'Nenhuma ainda. Comece lançando seus gastos e receitas.' : 'Você desbloqueou todas!'}</p> : null}
            </div>
          </div>
        </section>
      </div>

      <Poster size="md" kicker="Linha do tempo" lines={[{ text: 'Não é só dinheiro.' }, { text: 'É o seu caminho.', accent: true }]} />

      <div className="grid data-grid">
        <section className="sheet sheet-solo" aria-labelledby="tl-titulo">
          <div className="block">
            <div className="block-head">
              <div>
                <h2 className="card-title" id="tl-titulo">
                  Metas e marcos
                </h2>
                <p className="block-sub">Do primeiro lançamento até as metas que você quer alcançar.</p>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => openGoal({ mode: 'novo' })}>
                <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                Nova meta
              </button>
            </div>
            <UnderlineTabs
              label="Mostrar na linha do tempo"
              value={lineFilter}
              onChange={setLineFilter}
              options={[
                { value: 'tudo', label: 'Tudo' },
                { value: 'metas', label: 'Metas', count: fin.goals.length },
                { value: 'conquistas', label: 'Conquistas', count: unlocked.length },
                { value: 'marcos', label: 'Marcos', count: milestones.length },
              ]}
            />
            {line.past.length + line.future.length === 0 ? (
              <div className="tl-empty">
                <Target size={22} aria-hidden="true" />
                <p>{lineFilter === 'metas' || !fin.expenses.length ? 'Crie uma meta, como “Viagem” ou “Reserva de emergência”, e acompanhe aqui.' : 'Nada por aqui ainda.'}</p>
                <button type="button" className="btn btn-secondary" onClick={() => openGoal({ mode: 'novo' })}>
                  <Plus size={16} aria-hidden="true" />
                  Criar meta
                </button>
              </div>
            ) : (
              <ol className="tl" ref={lineRef}>
                {line.past.map(renderItem)}
                <li className="tl-today" aria-label={`Hoje, ${dmy(today)}`}>
                  <span>Hoje</span> {dmy(today)}
                </li>
                {line.future.map(renderItem)}
              </ol>
            )}
          </div>
        </section>
      </div>

      {shownEditor ? (
        <GoalDrawer
          key={shownEditor.nonce}
          state={shownEditor}
          leaving={leaving}
          today={today}
          portfolio={portfolio}
          onClose={() => setEditor(null)}
          onSave={saveGoal}
          onDelete={removeGoal}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Formulário de meta

function GoalDrawer({
  state,
  leaving,
  today,
  portfolio,
  onClose,
  onSave,
  onDelete,
}: {
  state: GoalEditor;
  leaving: boolean;
  today: string;
  portfolio: Portfolio;
  onClose: () => void;
  onSave: (g: Goal) => void;
  onDelete: (g: Goal) => void;
}) {
  const fin = useFinance();
  const panelRef = useRef<HTMLElement | null>(null);
  const firstRef = useRef<HTMLInputElement | null>(null);
  useBodyLock(true);
  useFocusTrap(true, panelRef, firstRef);
  const goal = state.mode === 'editar' ? state.goal : null;
  const investments = fin.invest.list;

  const [id] = useState(() => goal?.id ?? newGoalId());
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? formatBRLInput(goal.target) : '');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [source, setSource] = useState<GoalSource>(goal?.source ?? (investments.length ? 'carteira' : 'manual'));
  const [investmentId, setInvestmentId] = useState(goal?.investmentId ?? investments[0]?.id ?? '');
  const [saved, setSaved] = useState(goal ? formatBRLInput(goal.saved) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const targetNum = parseBRL(target);
  const draft: Goal = {
    id,
    name: name.trim().slice(0, 80),
    target: targetNum ?? 0,
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null,
    source,
    investmentId: source === 'investimento' ? investmentId || null : null,
    saved: source === 'manual' ? Math.max(0, parseBRL(saved) ?? 0) : goal?.saved ?? 0,
    createdAt: goal?.createdAt || today,
  };
  const current = goalCurrent(draft, portfolio);
  const perMonth = draft.target > current && draft.deadline && draft.deadline > today ? (draft.target - current) / monthsUntil(today, draft.deadline) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!draft.name) errs.name = 'Dê um nome, como “Viagem” ou “Carro novo”.';
    if (targetNum === null || targetNum <= 0) errs.target = 'Informe quanto você quer juntar, como 5.000,00.';
    if (source === 'investimento' && !investmentId) errs.source = 'Escolha um investimento.';
    if (source === 'manual' && saved.trim() && parseBRL(saved) === null) errs.saved = 'Informe um valor, como 750,00.';
    setErrors(errs);
    const first = ['name', 'target', 'source', 'saved'].find((k) => errs[k]);
    if (first) {
      document.getElementById(`meta-${first}`)?.focus();
      return;
    }
    onSave(draft);
  };

  const err = (k: string) =>
    errors[k] ? (
      <span className="field-error" id={`meta-${k}-erro`}>
        <TriangleAlert size={13} aria-hidden="true" />
        {errors[k]}
      </span>
    ) : null;

  const sources = (Object.keys(GOAL_SOURCES) as GoalSource[]).filter((s) => s !== 'investimento' || investments.length);

  return (
    <div className="overlay-root" data-leaving={leaving ? '' : undefined}>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className="drawer drawer-form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meta-titulo"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="drawer-head">
          <div>
            <p className="drawer-kicker">Linha do tempo</p>
            <h2 id="meta-titulo" className="drawer-title">
              {goal ? 'Editar meta' : 'Nova meta'}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar formulário">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <form id="form-meta" className="drawer-body form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="meta-name">Nome da meta</label>
            <input
              ref={firstRef}
              id="meta-name"
              className="input"
              list="meta-sugestoes"
              value={name}
              maxLength={80}
              placeholder="Ex.: Viagem, Reserva de emergência, Carro"
              autoComplete="off"
              aria-invalid={!!errors.name || undefined}
              aria-describedby={errors.name ? 'meta-name-erro' : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            <datalist id="meta-sugestoes">
              {['Reserva de emergência', 'Viagem', 'Carro', 'Casa própria', 'Curso', 'Celular novo', 'Aposentadoria'].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {err('name')}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="meta-target">Quanto quer juntar</label>
              <span className="input-money">
                <span aria-hidden="true">R$</span>
                <input
                  id="meta-target"
                  className="input"
                  inputMode="decimal"
                  value={target}
                  placeholder="0,00"
                  autoComplete="off"
                  aria-invalid={!!errors.target || undefined}
                  aria-describedby={errors.target ? 'meta-target-erro' : undefined}
                  onChange={(e) => setTarget(e.target.value)}
                  onBlur={(e) => {
                    const v = parseBRL(e.target.value);
                    if (v !== null) setTarget(formatBRLInput(v));
                  }}
                />
              </span>
              {err('target')}
            </div>
            <div className="field">
              <label htmlFor="meta-deadline">
                Até quando <span className="opt">(opcional)</span>
              </label>
              <input id="meta-deadline" type="date" className="input" value={deadline} min={today} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <span className="legend-like" id="meta-source">
              Como acompanhar
            </span>
            <Segmented label="Como acompanhar o progresso" value={source} options={sources.map((s) => ({ value: s, label: GOAL_SOURCES[s] }))} onChange={setSource} />
            {source === 'investimento' ? (
              <select id="meta-inv" className="input" value={investmentId} onChange={(e) => setInvestmentId(e.target.value)} aria-label="Investimento da meta">
                {investments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            ) : null}
            {source === 'manual' ? (
              <span className="input-money">
                <span aria-hidden="true">R$</span>
                <input
                  id="meta-saved"
                  className="input"
                  inputMode="decimal"
                  value={saved}
                  placeholder="Quanto já guardou"
                  autoComplete="off"
                  aria-label="Quanto já guardou"
                  aria-invalid={!!errors.saved || undefined}
                  onChange={(e) => setSaved(e.target.value)}
                  onBlur={(e) => {
                    const v = parseBRL(e.target.value);
                    if (v !== null) setSaved(formatBRLInput(v));
                  }}
                />
              </span>
            ) : null}
            {err('source')}
            {err('saved')}
            <span className="field-hint">
              {source === 'carteira'
                ? `Usa o valor de hoje de todos os investimentos (${brl(portfolio.value)}).`
                : source === 'investimento'
                  ? 'Usa o valor de hoje do investimento escolhido.'
                  : 'Você mesmo atualiza quanto já guardou, quando quiser.'}
            </span>
          </div>

          {draft.target > 0 ? (
            <p className="field-hint form-hint">
              Hoje: <strong>{brl(current)}</strong> ({fmt.pct(Math.min(1, current / draft.target), 0)} da meta).
              {perMonth !== null ? ` Para chegar até ${dmy(draft.deadline!)}, guarde cerca de ${brl(perMonth)} por mês (sem contar rendimento).` : ''}
            </p>
          ) : null}
        </form>

        <footer className="drawer-foot form-foot">
          {confirmDelete && goal ? (
            <div className="discard" role="alert">
              <p>Excluir a meta “{goal.name}”?</p>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-danger" onClick={() => onDelete(goal)}>
                Excluir
              </button>
            </div>
          ) : (
            <>
              {goal ? (
                <div className="form-foot-left">
                  <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={15} aria-hidden="true" />
                    Excluir
                  </button>
                </div>
              ) : null}
              <div className="form-foot-right">
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancelar
                </button>
                <button type="submit" form="form-meta" className="btn btn-primary">
                  {goal ? 'Salvar alterações' : 'Criar meta'}
                </button>
              </div>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
