import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bitcoin,
  Building,
  Calculator,
  ChartCandlestick,
  Copy,
  Ellipsis,
  House,
  Landmark,
  PiggyBank,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Umbrella,
  X,
  type LucideIcon,
} from 'lucide-react';
import { fmt, fmtDate } from '../lib/format';
import { formatBRLInput, isoDate, monthKeyOf, monthLabel, monthShort, parseBRL, parseIso } from '../lib/finance';
import { useFinance } from '../lib/financeStore';
import { copyText, storage, useBodyLock, useCountUp, useFocusTrap, useReducedMotion } from '../lib/hooks';
import {
  INVEST_ORDER,
  INVEST_TYPES,
  RATE_KINDS,
  annualRate,
  aportesByMonth,
  buildPortfolio,
  generateSampleInvestments,
  isSampleInvestment,
  monthlyForGoal,
  monthlyFromAnnual,
  newInvestId,
  positionOf,
  rateText,
  simulate,
  type InvestType,
  type Investment,
  type Position,
  type RateKind,
} from '../lib/invest';
import { spotlight, usePresence } from '../lib/motion';
import { FloatingTip, Popover, Segmented, Swatch, UnderlineTabs, cssVars, cx, tipPosition, type TipState } from './ui';
import { BolsaView } from './bolsa';
import { Poster } from './poster';
import { useToast } from './toast';

// ---------------------------------------------------------------------------
// Formatação

const MINUS = '−';
const brl2 = (v: number) => (v < -0.005 ? MINUS : '') + fmt.brl2(Math.abs(v));
const brlK = (v: number) => (v < -0.5 ? MINUS : '') + fmt.brlCompact(Math.abs(v));
const signedBrl = (v: number) => (v > 0.005 ? '+' : '') + brl2(v);
const pct = (v: number, digits = 2) => `${fmt.dec(v * 100, digits)}%`;
const signedPct = (v: number, digits = 2) => (v > 0.00005 ? '+' : v < -0.00005 ? MINUS : '') + pct(Math.abs(v), digits);
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
const dmy = (iso: string) => fmtDate.dayMonthYear(parseIso(iso));

/** Lê números digitados em português: "1.234,5", "-12,75", "12.5" ou "15%". */
export function parseNum(input: string): number | null {
  const raw = input.replace(/[R$%\s ]/g, '');
  if (!raw) return null;
  const neg = /^[-−]/.test(raw);
  const s = raw.replace(/^[-−+]/, '');
  let norm: string;
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length === 1 && !/\.\d{3}$/.test(s)) norm = s;
  else norm = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(norm) && !/^\.\d+$/.test(norm)) return null;
  const n = parseFloat(norm);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const numInput = (n: number, digits = 2) => n.toLocaleString('pt-BR', { maximumFractionDigits: digits });

export const INVEST_ICON: Record<InvestType, LucideIcon> = {
  tesouro: Landmark,
  cdb: Building,
  poupanca: PiggyBank,
  acoes: ChartCandlestick,
  fiis: House,
  cripto: Bitcoin,
  previdencia: Umbrella,
  outros: ShieldCheck,
};

const NAME_SUGGESTIONS = ['Reserva de emergência', 'Tesouro Selic', 'Tesouro IPCA+', 'CDB', 'LCI', 'LCA', 'Poupança', 'Caixinha', 'Ações', 'FIIs', 'Bitcoin', 'Previdência'];

export type InvestIntent = 'novo' | 'simulador' | 'porcentagem' | 'bolsa';

type InvestTab = 'carteira' | 'bolsa';
const TABS: { value: InvestTab; label: string }[] = [
  { value: 'carteira', label: 'Minha carteira' },
  { value: 'bolsa', label: 'Bolsa' },
];

type EditorRequest = { mode: 'novo' } | { mode: 'editar' | 'aporte' | 'resgate' | 'valor'; inv: Investment };
type EditorState = EditorRequest & { nonce: number };

// ---------------------------------------------------------------------------
// Tela

export function InvestView({ now, intent, onIntentDone }: { now: Date; intent: InvestIntent | null; onIntentDone: () => void }) {
  const fin = useFinance();
  const toast = useToast();
  const reduced = useReducedMotion();
  const today = isoDate(now);
  const { list, cdi } = fin.invest;
  const portfolio = useMemo(() => buildPortfolio(list, today, cdi), [list, today, cdi]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [shownEditor, editorLeaving] = usePresence(editor, 240);
  const [seed, setSeed] = useState<SimSeed | null>(null);
  const nonce = useRef(0);
  const simRef = useRef<HTMLElement | null>(null);
  const pctRef = useRef<HTMLElement | null>(null);
  const samples = list.filter(isSampleInvestment);
  const [tab, setTabState] = useState<InvestTab>(() => (storage.get<InvestTab>('orla.invest.aba', 'carteira') === 'bolsa' ? 'bolsa' : 'carteira'));
  const setTab = (t: InvestTab) => {
    setTabState(t);
    storage.set('orla.invest.aba', t);
  };

  const open = (s: EditorRequest) => setEditor({ ...s, nonce: ++nonce.current });
  // Dois quadros: dá tempo de a aba da carteira aparecer antes de rolar.
  const scrollTo = (pick: () => HTMLElement | null) =>
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => pick()?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })));

  useEffect(() => {
    if (!intent) return;
    setTab(intent === 'bolsa' ? 'bolsa' : 'carteira');
    if (intent === 'novo') open({ mode: 'novo' });
    else if (intent !== 'bolsa') scrollTo(() => (intent === 'simulador' ? simRef.current : pctRef.current));
    onIntentDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  /** Grava a lista nova e oferece desfazer. */
  const commit = (next: Investment[], message: string, nextCdi = cdi) => {
    const previous = fin.saveInvest({ list: next, cdi: nextCdi });
    toast(message, 'success', { action: { label: 'Desfazer', run: () => fin.saveInvest(previous) } });
  };

  const upsert = (inv: Investment, message: string) => {
    const exists = list.some((x) => x.id === inv.id);
    commit(exists ? list.map((x) => (x.id === inv.id ? inv : x)) : [...list, inv], message);
    setEditor(null);
  };

  const removeInv = (inv: Investment) => {
    commit(
      list.filter((x) => x.id !== inv.id),
      `Investimento “${inv.name}” excluído`,
    );
    setEditor(null);
  };

  const loadSamples = () => {
    const prev = fin.saveInvest({ list: [...list.filter((x) => !isSampleInvestment(x)), ...generateSampleInvestments(now)], cdi });
    toast('Exemplos carregados. Apague quando quiser começar com os seus.', 'info', { action: { label: 'Desfazer', run: () => fin.saveInvest(prev) } });
  };

  const removeSamples = () => commit(list.filter((x) => !isSampleInvestment(x)), plural(samples.length, 'exemplo apagado', 'exemplos apagados'));

  const simulateFrom = (inv: Investment, p: Position) => {
    setSeed({ initial: p.value, rateKind: inv.rateKind === 'nenhuma' ? 'ano' : inv.rateKind, rate: inv.rateKind === 'nenhuma' ? 10 : inv.rate, key: Date.now(), name: inv.name });
    scrollTo(() => simRef.current);
  };

  const editorEl = shownEditor ? (
    <InvestDrawer
      key={shownEditor.nonce}
      state={shownEditor}
      leaving={editorLeaving}
      today={today}
      cdi={cdi}
      onClose={() => setEditor(null)}
      onSave={upsert}
      onDelete={removeInv}
    />
  ) : null;

  const tabs = (
    <div className="inv-tabs">
      <UnderlineTabs label="Investimentos" value={tab} options={TABS} onChange={setTab} />
    </div>
  );

  if (tab === 'bolsa')
    return (
      <>
        {tabs}
        <BolsaView />
      </>
    );

  return (
    <>
      {tabs}
      <Poster
        kicker="Investimentos"
        lines={list.length ? [{ text: 'Seu dinheiro' }, { text: portfolio.gain > 0.005 ? `+${fmt.brl(portfolio.gain)} rendendo` : fmt.brl(portfolio.value), accent: true }] : [{ text: 'Faça o dinheiro' }, { text: 'trabalhar.', accent: true }]}
        sub={list.length ? `Patrimônio de ${fmt.brl(portfolio.value)} em ${plural(list.length, 'investimento', 'investimentos')}.` : 'Cadastre onde você guarda dinheiro e veja quanto rende.'}
      />
      <div className="fin-bar inv-bar">
        <p className="period-text">
          <TrendingUp size={15} aria-hidden="true" />
          <span>
            <span className="period-main">Valores antes do imposto de renda</span>
            <span className="period-compare">o que não foi conferido no banco hoje é estimado pela taxa</span>
          </span>
        </p>
        <div className="fin-bar-actions">
          <CdiButton cdi={cdi} onSave={(v) => commit(list, `CDI atualizado para ${numInput(v)}% ao ano`, v)} />
          <button type="button" className="btn btn-primary" onClick={() => open({ mode: 'novo' })}>
            <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
            Novo investimento
          </button>
        </div>
      </div>

      <div className="grid fin-grid inv-grid" data-syncing={fin.ready ? undefined : ''}>
        {samples.length ? (
          <section className="fin-alerts" aria-label="Avisos">
            <div className="fin-alert" data-tone="neutral">
              <span className="fin-alert-icon">
                <Sparkles size={18} aria-hidden="true" />
              </span>
              <p>
                <strong>Você está vendo investimentos de exemplo.</strong> Apague quando quiser começar com os seus.
              </p>
              <button type="button" className="btn btn-secondary sm" onClick={removeSamples}>
                Apagar exemplos
              </button>
            </div>
          </section>
        ) : null}

        <section className="sheet sheet-fin-hero" aria-labelledby="inv-total" onPointerMove={spotlight}>
          <PortfolioSummary portfolio={portfolio} list={list} />
          <div className="fin-chart">
            <AportesChart list={list} current={monthKeyOf(now)} />
          </div>
        </section>

        <section className="sheet sheet-ledger" aria-labelledby="inv-carteira">
          <Wallet
            list={list}
            portfolio={portfolio}
            onNew={() => open({ mode: 'novo' })}
            onSamples={loadSamples}
            onEdit={(inv) => open({ mode: 'editar', inv })}
            onMove={(inv, mode) => open({ mode, inv })}
            onSimulate={simulateFrom}
          />
        </section>

        <section className="sheet inv-sim-sheet" ref={simRef} aria-labelledby="inv-sim">
          <Simulator cdi={cdi} seed={seed} />
        </section>

        <section className="sheet inv-pct-sheet" ref={pctRef} aria-labelledby="inv-pct">
          <PercentCalc />
        </section>
      </div>
      {editorEl}
    </>
  );
}

// ---------------------------------------------------------------------------
// CDI usado nas contas

function CdiButton({ cdi, onSave }: { cdi: number; onSave: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(numInput(cdi));
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const value = parseNum(text);
  const valid = value !== null && value > 0 && value < 100;
  return (
    <div className="pop-anchor">
      <button
        ref={btnRef}
        type="button"
        className="btn btn-secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setText(numInput(cdi));
          setOpen((v) => !v);
        }}
      >
        CDI {numInput(cdi)}% a.a.
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} label="CDI usado nas contas" className="menu inv-cdi-pop">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSave(value!);
            setOpen(false);
          }}
        >
          <label htmlFor="inv-cdi" className="inv-cdi-label">
            CDI usado nas contas
          </label>
          <span className="input-money input-suffix">
            <input id="inv-cdi" className="input" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-invalid={!valid || undefined} />
            <span aria-hidden="true">% ao ano</span>
          </span>
          <p className="field-hint">Confira o valor atual no site do seu banco. Ele vale para os investimentos em “% do CDI” e para o simulador.</p>
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            Salvar
          </button>
        </form>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resumo da carteira

function PortfolioSummary({ portfolio, list }: { portfolio: ReturnType<typeof buildPortfolio>; list: Investment[] }) {
  const total = useCountUp(portfolio.value);
  const [tip, setTip] = useState<TipState | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const gainTone = portfolio.gain > 0.005 ? 'good' : portfolio.gain < -0.005 ? 'bad' : 'flat';
  return (
    <div className="fin-summary">
      <div className="fin-summary-head">
        <h2 className="card-title" id="inv-total">
          Patrimônio investido
        </h2>
        {portfolio.estimated ? <span className="tag">estimado</span> : null}
      </div>
      <p className="hero-figure">
        <span className="hero-value">{brl2(total)}</span>
        {portfolio.gainPct !== null ? (
          <span className="delta" data-tone={gainTone}>
            <TrendingUp size={14} strokeWidth={2.4} aria-hidden="true" />
            <span>{signedPct(portfolio.gainPct)}</span>
          </span>
        ) : null}
      </p>
      <p className="hero-caption">
        {!list.length
          ? 'Cadastre onde você guarda dinheiro para acompanhar quanto rende.'
          : portfolio.gain >= 0
            ? `Seu dinheiro já rendeu ${brl2(portfolio.gain)} sobre ${brl2(portfolio.invested)} aplicados.`
            : `Está ${brl2(-portfolio.gain)} abaixo do que você aplicou (${brl2(portfolio.invested)}).`}
      </p>

      <dl className="fin-kv">
        <div>
          <dt>Total aplicado</dt>
          <dd>
            <span className="count">{brl2(portfolio.invested)}</span>
          </dd>
          <span className="fin-kv-sub">aportes menos resgates</span>
        </div>
        <div>
          <dt>Rendimento</dt>
          <dd>
            <span className={cx('count', portfolio.gain > 0.005 && 'num-pos', portfolio.gain < -0.005 && 'num-neg')}>{signedBrl(portfolio.gain)}</span>
          </dd>
        </div>
      </dl>

      {portfolio.byType.length ? (
        <div className="split">
          <p className="split-title">Como sua carteira está dividida</p>
          <div className="split-box" ref={boxRef}>
            <div className="stackbar split-bar" role="img" aria-label={portfolio.byType.map((t) => `${INVEST_TYPES[t.type].label}: ${pct(t.share, 1)}`).join(', ')}>
              {portfolio.byType.map((t) => (
                <span
                  key={t.type}
                  className="stackbar-seg"
                  style={{ flexGrow: t.share, background: INVEST_TYPES[t.type].color }}
                  onPointerEnter={(e) =>
                    boxRef.current &&
                    setTip({
                      ...tipPosition(e.currentTarget, boxRef.current, 90),
                      content: (
                        <>
                          <strong>{brl2(t.value)}</strong>
                          <span className="ftip-sub">
                            {INVEST_TYPES[t.type].label}, {pct(t.share, 1)} da carteira
                          </span>
                        </>
                      ),
                    })
                  }
                  onPointerLeave={() => setTip(null)}
                />
              ))}
            </div>
            <FloatingTip tip={tip} />
          </div>
          <ul className="split-legend">
            {portfolio.byType.map((t) => (
              <li key={t.type}>
                <Swatch color={INVEST_TYPES[t.type].color} />
                <span className="split-name">{INVEST_TYPES[t.type].label}</span>
                <span className="split-per">{pct(t.share, 1)}</span>
                <span className="split-value">{brlK(t.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aportes por mês (uma série: o título nomeia, sem legenda)

function AportesChart({ list, current }: { list: Investment[]; current: string }) {
  const data = useMemo(() => aportesByMonth(list, current, 12), [list, current]);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const net = data.map((d) => d.aportes - d.resgates);
  const max = Math.max(1, ...net.map((v) => Math.abs(v)));
  const total = data.reduce((s, d) => s + d.aportes, 0);
  const months = data.filter((d) => d.aportes > 0).length;
  return (
    <div className="pchart-wrap">
      <div className="block-head">
        <div>
          <h3 className="card-title">Aportes por mês</h3>
          <p className="block-sub">
            {total ? `${brl2(total)} aplicados nos últimos 12 meses, ${plural(months, 'mês', 'meses')} com aporte` : 'Os aportes dos últimos 12 meses aparecem aqui'}
          </p>
        </div>
      </div>
      <div className="ichart" ref={boxRef}>
        <div className="ichart-cols">
          {data.map((d, i) => {
            const v = net[i];
            const h = v ? Math.max(3, (Math.abs(v) / max) * 100) : 0;
            return (
              <div
                key={d.key}
                className="ichart-col"
                data-current={d.key === current ? '' : undefined}
                style={cssVars({ '--i': i })}
                tabIndex={0}
                aria-label={`${monthLabel(d.key)}: aportes ${brl2(d.aportes)}${d.resgates ? `, resgates ${brl2(d.resgates)}` : ''}`}
                onPointerEnter={(e) =>
                  boxRef.current &&
                  setTip({
                    ...tipPosition(e.currentTarget.firstElementChild ?? e.currentTarget, boxRef.current, 90),
                    content: (
                      <>
                        <strong>{brl2(d.aportes)} aplicados</strong>
                        <span className="ftip-sub">{monthLabel(d.key)}</span>
                        {d.resgates ? <span className="ftip-sub">Resgates {brl2(d.resgates)}</span> : null}
                      </>
                    ),
                  })
                }
                onPointerLeave={() => setTip(null)}
              >
                <span className="ichart-bar" data-neg={v < 0 ? '' : undefined} style={{ height: `${h}%` }} />
              </div>
            );
          })}
        </div>
        <div className="ichart-x" aria-hidden="true">
          {data.map((d) => (
            <span key={d.key} data-current={d.key === current ? '' : undefined}>
              {monthShort(d.key)}
            </span>
          ))}
        </div>
        <FloatingTip tip={tip} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carteira

function Wallet({
  list,
  portfolio,
  onNew,
  onSamples,
  onEdit,
  onMove,
  onSimulate,
}: {
  list: Investment[];
  portfolio: ReturnType<typeof buildPortfolio>;
  onNew: () => void;
  onSamples: () => void;
  onEdit: (inv: Investment) => void;
  onMove: (inv: Investment, mode: 'aporte' | 'resgate' | 'valor') => void;
  onSimulate: (inv: Investment, p: Position) => void;
}) {
  const sorted = [...list].sort((a, b) => (portfolio.positions.get(b.id)?.value ?? 0) - (portfolio.positions.get(a.id)?.value ?? 0));
  return (
    <div className="block">
      <div className="block-head">
        <div>
          <h2 className="card-title" id="inv-carteira">
            Sua carteira
          </h2>
          <p className="block-sub">
            {list.length ? `${plural(list.length, 'investimento', 'investimentos')}, ${brl2(portfolio.value)} hoje` : 'Nenhum investimento ainda'}
          </p>
        </div>
      </div>

      {!list.length ? (
        <div className="empty">
          <PiggyBank size={24} aria-hidden="true" />
          <p className="empty-title">Comece pelo que você já tem guardado</p>
          <p className="empty-text">Reserva de emergência, Tesouro, CDB, poupança ou ações. Informe quanto aplicou e a taxa: o painel calcula quanto rendeu.</p>
          <div className="block-actions inv-empty-actions">
            <button type="button" className="btn btn-primary" onClick={onNew}>
              <Plus size={16} aria-hidden="true" />
              Adicionar investimento
            </button>
            <button type="button" className="btn btn-secondary" onClick={onSamples}>
              <Sparkles size={16} aria-hidden="true" />
              Ver com exemplos
            </button>
          </div>
        </div>
      ) : (
        <ul className="inv-list">
          {sorted.map((inv, i) => (
            <InvestRow
              key={inv.id}
              inv={inv}
              index={i}
              p={portfolio.positions.get(inv.id)!}
              share={portfolio.value ? (portfolio.positions.get(inv.id)!.value / portfolio.value) : 0}
              onEdit={() => onEdit(inv)}
              onMove={(m) => onMove(inv, m)}
              onSimulate={() => onSimulate(inv, portfolio.positions.get(inv.id)!)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function InvestRow({
  inv,
  p,
  index,
  share,
  onEdit,
  onMove,
  onSimulate,
}: {
  inv: Investment;
  p: Position;
  index: number;
  share: number;
  onEdit: () => void;
  onMove: (m: 'aporte' | 'resgate' | 'valor') => void;
  onSimulate: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const Icon = INVEST_ICON[inv.type];
  const tone = p.gain > 0.005 ? 'good' : p.gain < -0.005 ? 'bad' : 'flat';
  return (
    <li className="inv-row" style={cssVars({ '--i': Math.min(index, 12) })}>
      <button type="button" className="inv-main" onClick={onEdit} aria-label={`Editar ${inv.name}`}>
        <span className="inv-icon" aria-hidden="true" style={cssVars({ '--c': INVEST_TYPES[inv.type].color })}>
          <Icon size={18} strokeWidth={1.9} />
        </span>
        <span className="inv-text">
          <span className="inv-name">{inv.name}</span>
          <span className="inv-sub">
            {[inv.institution, INVEST_TYPES[inv.type].label, rateText(inv)].filter(Boolean).join(' · ')}
          </span>
          <span className="inv-share" aria-hidden="true">
            <span style={{ width: `${Math.max(2, share * 100)}%`, background: INVEST_TYPES[inv.type].color }} />
          </span>
        </span>
      </button>
      <dl className="inv-nums">
        <div>
          <dt>Aplicado</dt>
          <dd>{brl2(p.invested)}</dd>
        </div>
        <div>
          <dt>Hoje {p.estimated ? <span className="tag">estimado</span> : null}</dt>
          <dd className="strong">{brl2(p.value)}</dd>
        </div>
        <div>
          <dt>Rendeu</dt>
          <dd className={cx(tone === 'good' && 'num-pos', tone === 'bad' && 'num-neg')}>
            {signedBrl(p.gain)}
            {p.gainPct !== null ? <span className="inv-pct">{signedPct(p.gainPct)}</span> : null}
          </dd>
        </div>
      </dl>
      <div className="inv-actions">
        <button type="button" className="btn btn-secondary xs" onClick={() => onMove('aporte')}>
          <ArrowDownToLine size={14} aria-hidden="true" />
          Aportar
        </button>
        <button type="button" className="btn btn-secondary xs" onClick={() => onMove('valor')}>
          <RefreshCw size={14} aria-hidden="true" />
          Atualizar valor
        </button>
        <div className="pop-anchor">
          <button ref={menuBtn} type="button" className="icon-btn sm" aria-haspopup="menu" aria-expanded={menu} aria-label={`Mais opções de ${inv.name}`} onClick={() => setMenu((v) => !v)}>
            <Ellipsis size={18} aria-hidden="true" />
          </button>
          <Popover open={menu} onClose={() => setMenu(false)} anchorRef={menuBtn} label="Mais opções" className="menu">
            <div role="menu">
              {(
                [
                  ['Resgatar', ArrowUpFromLine, () => onMove('resgate')],
                  ['Simular o futuro', Calculator, onSimulate],
                  ['Editar e ver histórico', Target, onEdit],
                ] as const
              ).map(([label, I, run]) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setMenu(false);
                    run();
                  }}
                >
                  <I size={16} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </Popover>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Simulador

type SimRateKind = Exclude<RateKind, 'nenhuma'>;
interface SimSeed {
  initial: number;
  rateKind: SimRateKind;
  rate: number;
  key: number;
  name: string;
}

const SIM_RATE_OPTIONS: { value: SimRateKind; label: string }[] = [
  { value: 'ano', label: '% ao ano' },
  { value: 'mes', label: '% ao mês' },
  { value: 'cdi', label: '% do CDI' },
];

function MoneyInput({ id, value, onChange, placeholder = '0,00' }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <span className="input-money">
      <span aria-hidden="true">R$</span>
      <input
        id={id}
        className="input"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          const v = parseBRL(e.target.value);
          if (v !== null) onChange(formatBRLInput(v));
        }}
      />
    </span>
  );
}

function Simulator({ cdi, seed }: { cdi: number; seed: SimSeed | null }) {
  const [initial, setInitial] = useState('1.000,00');
  const [monthly, setMonthly] = useState('300,00');
  const [rate, setRate] = useState('12');
  const [rateKind, setRateKind] = useState<SimRateKind>('ano');
  const [term, setTerm] = useState('5');
  const [unit, setUnit] = useState<'anos' | 'meses'>('anos');
  const [goal, setGoal] = useState('');
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    if (!seed) return;
    setInitial(formatBRLInput(Math.round(seed.initial * 100) / 100));
    setRateKind(seed.rateKind);
    setRate(numInput(seed.rate));
    setFrom(seed.name);
  }, [seed]);

  const r = parseNum(rate) ?? 0;
  const annual = annualRate({ rateKind, rate: r }, cdi);
  const mRate = monthlyFromAnnual(annual);
  const t = Math.min(600, Math.max(0, Math.round(parseNum(term) ?? 0) * (unit === 'anos' ? 12 : 1)));
  const init = parseBRL(initial) ?? 0;
  const mon = parseBRL(monthly) ?? 0;
  const points = useMemo(() => simulate({ initial: init, monthly: mon, monthlyRate: mRate, months: t }), [init, mon, mRate, t]);
  const last = points[points.length - 1];
  const interest = last.total - last.invested;
  const goalValue = parseBRL(goal);
  const needed = goalValue ? monthlyForGoal(goalValue, init, mRate, t) : null;
  const finalShown = useCountUp(last.total);

  return (
    <div className="block">
      <div className="block-head">
        <div>
          <h2 className="card-title" id="inv-sim">
            Simulador de investimento
          </h2>
          <p className="block-sub">{from ? `Começando com o que você tem em “${from}”` : 'Quanto seu dinheiro vira com juros compostos e aporte todo mês'}</p>
        </div>
      </div>
      <div className="sim">
        <form className="form sim-form" onSubmit={(e) => e.preventDefault()}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="sim-initial">Valor inicial</label>
              <MoneyInput id="sim-initial" value={initial} onChange={setInitial} />
            </div>
            <div className="field">
              <label htmlFor="sim-monthly">Aporte por mês</label>
              <MoneyInput id="sim-monthly" value={monthly} onChange={setMonthly} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="sim-rate">Rentabilidade</label>
            <div className="sim-pair">
              <span className="input-money input-suffix">
                <input id="sim-rate" className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} autoComplete="off" />
                <span aria-hidden="true">%</span>
              </span>
              <Segmented label="Tipo de taxa" value={rateKind} options={SIM_RATE_OPTIONS} onChange={setRateKind} />
            </div>
            <span className="field-hint">
              Equivale a {pct(annual)} ao ano, ou {pct(mRate, 3)} ao mês{rateKind === 'cdi' ? `, com CDI de ${numInput(cdi)}%` : ''}.
            </span>
          </div>
          <div className="field">
            <label htmlFor="sim-term">Por quanto tempo</label>
            <div className="sim-pair">
              <input id="sim-term" className="input sim-term" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" />
              <Segmented
                label="Unidade do prazo"
                value={unit}
                options={[
                  { value: 'anos', label: 'Anos' },
                  { value: 'meses', label: 'Meses' },
                ]}
                onChange={setUnit}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="sim-goal">
              Quero chegar em <span className="opt">(opcional)</span>
            </label>
            <MoneyInput id="sim-goal" value={goal} onChange={setGoal} placeholder="Ex.: 100.000,00" />
          </div>
        </form>

        <div className="sim-result" aria-live="polite">
          <p className="sim-kicker">Em {t >= 12 && t % 12 === 0 ? plural(t / 12, 'ano', 'anos') : plural(t, 'mês', 'meses')} você teria</p>
          <p className="hero-value sim-total">{brl2(finalShown)}</p>
          <dl className="fin-kv sim-kv">
            <div>
              <dt>Você investiu</dt>
              <dd>{brl2(last.invested)}</dd>
            </div>
            <div>
              <dt>Juros ganhos</dt>
              <dd className="num-pos">{signedBrl(interest)}</dd>
            </div>
            <div>
              <dt>O dinheiro cresceu</dt>
              <dd>{last.invested > 0 ? signedPct(interest / last.invested) : '—'}</dd>
            </div>
          </dl>
          {needed !== null && goalValue ? (
            <p className="sim-goal">
              <Target size={16} aria-hidden="true" />
              <span>
                {needed <= 0.005 ? (
                  <>
                    Só com o valor inicial você já passa de <strong>{brl2(goalValue)}</strong> nesse prazo.
                  </>
                ) : (
                  <>
                    Para chegar em <strong>{brl2(goalValue)}</strong>, aporte <strong>{brl2(needed)} por mês</strong>.
                  </>
                )}
              </span>
            </p>
          ) : null}
          <SimChart points={points} />
          <p className="side-note">Simulação com taxa constante, antes do imposto de renda e da inflação.</p>
        </div>
      </div>
    </div>
  );
}

/** Colunas empilhadas: o que você colocou e os juros por cima. */
function SimChart({ points }: { points: { month: number; invested: number; total: number }[] }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const months = points.length - 1;
  if (months < 1) return null;
  const byYear = months > 24;
  const step = byYear ? 12 * Math.ceil(months / 12 / 30) : 1;
  const cols = points.filter((p) => p.month > 0 && (p.month % step === 0 || p.month === months));
  const max = Math.max(1, ...cols.map((c) => c.total));
  const label = (m: number) => (byYear ? `${Math.round((m / 12) * 10) / 10} ${m === 12 ? 'ano' : 'anos'}` : `${m}º mês`);
  const short = (m: number) => (byYear ? `${Math.round(m / 12)}a` : String(m));
  return (
    <div className="sim-chart">
      <ul className="sim-legend" aria-label="Legenda">
        <li>
          <Swatch color="var(--cat-1)" /> Você investiu
        </li>
        <li>
          <Swatch color="var(--cat-3)" /> Juros
        </li>
      </ul>
      <div className="ichart" ref={boxRef}>
        <div className="ichart-cols" role="img" aria-label={`Evolução: começa com ${brl2(points[0].total)} e termina em ${brl2(points[months].total)}`}>
          {cols.map((c, i) => {
            const juros = Math.max(0, c.total - c.invested);
            return (
              <div
                key={c.month}
                className="ichart-col"
                style={cssVars({ '--i': i })}
                onPointerEnter={(e) =>
                  boxRef.current &&
                  setTip({
                    ...tipPosition(e.currentTarget.lastElementChild ?? e.currentTarget, boxRef.current, 96),
                    content: (
                      <>
                        <strong>{brl2(c.total)}</strong>
                        <span className="ftip-sub">Depois de {label(c.month)}</span>
                        <span className="ftip-sub">
                          Investiu {brlK(c.invested)}, juros {brlK(juros)}
                        </span>
                      </>
                    ),
                  })
                }
                onPointerLeave={() => setTip(null)}
              >
                <span className="ichart-stack" style={{ height: `${(c.total / max) * 100}%` }}>
                  <span className="ichart-seg" style={{ flexGrow: juros, background: 'var(--cat-3)' }} />
                  <span className="ichart-seg" style={{ flexGrow: Math.min(c.invested, c.total), background: 'var(--cat-1)' }} />
                </span>
              </div>
            );
          })}
        </div>
        <div className="ichart-x" aria-hidden="true">
          {cols.map((c, i) => (
            <span key={c.month}>{cols.length > 14 && i % 2 === 1 && i !== cols.length - 1 ? '' : short(c.month)}</span>
          ))}
        </div>
        <FloatingTip tip={tip} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calculadora de porcentagem

type PctMode = 'de' | 'quanto' | 'variacao' | 'aplicar';

const PCT_MODES: { value: PctMode; label: string }[] = [
  { value: 'de', label: 'X% de um valor' },
  { value: 'quanto', label: 'Quantos %' },
  { value: 'variacao', label: 'Variação' },
  { value: 'aplicar', label: 'Aumento e desconto' },
];

function PercentCalc() {
  const toast = useToast();
  const [mode, setMode] = useState<PctMode>('de');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const x = parseNum(a);
  const y = parseNum(b);
  const n = (v: number) => fmt.dec(v, 2);
  const p = (v: number) => `${fmt.dec(v, Math.abs(v) < 1 ? 4 : 2).replace(/,?0+$/, '') || '0'}%`;

  const labels: Record<PctMode, [string, string, string, string]> = {
    de: ['Quanto é', '% de', 'Ex.: 15', 'Ex.: 200'],
    quanto: ['O valor', 'é quantos % de', 'Ex.: 30', 'Ex.: 200'],
    variacao: ['De', 'para', 'Valor antes', 'Valor depois'],
    aplicar: ['Valor', 'com porcentagem de', 'Ex.: 200', 'Ex.: 10'],
  };
  const [l1, l2, p1, p2] = labels[mode];

  let main: ReactNode = <span className="pct-empty">Preencha os dois campos</span>;
  let sentence = '';
  if (x !== null && y !== null) {
    if (mode === 'de') {
      const r = (x / 100) * y;
      main = n(r);
      sentence = `${p(x)} de ${n(y)} é ${n(r)}`;
    } else if (mode === 'quanto') {
      if (y === 0) main = <span className="pct-empty">O segundo valor não pode ser zero</span>;
      else {
        const r = (x / y) * 100;
        main = p(r);
        sentence = `${n(x)} é ${p(r)} de ${n(y)}`;
      }
    } else if (mode === 'variacao') {
      if (x === 0) main = <span className="pct-empty">O valor de antes não pode ser zero</span>;
      else {
        const r = ((y - x) / Math.abs(x)) * 100;
        main = (r > 0 ? '+' : r < 0 ? MINUS : '') + p(Math.abs(r));
        sentence = `De ${n(x)} para ${n(y)}: ${r > 0 ? 'aumento' : r < 0 ? 'queda' : 'sem variação'}${r ? ` de ${p(Math.abs(r))}` : ''} (${r >= 0 ? '+' : MINUS}${n(Math.abs(y - x))})`;
      }
    } else {
      const up = x * (1 + y / 100);
      const down = x * (1 - y / 100);
      main = (
        <span className="pct-pair">
          <span>
            <small>Com aumento</small>
            {n(up)}
          </span>
          <span>
            <small>Com desconto</small>
            {n(down)}
          </span>
        </span>
      );
      sentence = `${n(x)} com ${p(y)} de aumento é ${n(up)}; com ${p(y)} de desconto é ${n(down)} (diferença de ${n(Math.abs((x * y) / 100))})`;
    }
  }

  return (
    <div className="block">
      <div className="block-head">
        <div>
          <h2 className="card-title" id="inv-pct">
            Calculadora de porcentagem
          </h2>
          <p className="block-sub">Para descontos, aumentos, rendimentos e quanto uma conta pesa no seu salário</p>
        </div>
      </div>
      <Segmented label="O que calcular" value={mode} options={PCT_MODES} onChange={(m) => setMode(m)} />
      <div className="pct">
        <form className="pct-form" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="pct-a">{l1}</label>
          <span className="input-money input-suffix">
            <input id="pct-a" className="input" inputMode="decimal" value={a} placeholder={p1} onChange={(e) => setA(e.target.value)} autoComplete="off" />
            {mode === 'de' ? <span aria-hidden="true">%</span> : null}
          </span>
          <label htmlFor="pct-b">{l2}</label>
          <span className="input-money input-suffix">
            <input id="pct-b" className="input" inputMode="decimal" value={b} placeholder={p2} onChange={(e) => setB(e.target.value)} autoComplete="off" />
            {mode === 'aplicar' ? <span aria-hidden="true">%</span> : null}
          </span>
        </form>
        <div className="pct-result" aria-live="polite">
          <p key={`${mode}-${sentence}`} className="pct-main">
            {main}
          </p>
          {sentence ? <p className="pct-sentence">{sentence}</p> : null}
          {sentence ? (
            <button
              type="button"
              className="chip-btn"
              onClick={async () => toast((await copyText(sentence)) ? 'Resultado copiado' : 'Não foi possível copiar', 'success')}
            >
              <Copy size={14} aria-hidden="true" />
              Copiar
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulário (novo, editar, aporte, resgate, atualizar valor)

const TITLES = { novo: 'Novo investimento', editar: 'Editar investimento', aporte: 'Registrar aporte', resgate: 'Registrar resgate', valor: 'Atualizar valor' };

function InvestDrawer({
  state,
  leaving,
  today,
  cdi,
  onClose,
  onSave,
  onDelete,
}: {
  state: EditorState;
  leaving: boolean;
  today: string;
  cdi: number;
  onClose: () => void;
  onSave: (inv: Investment, message: string) => void;
  onDelete: (inv: Investment) => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const firstRef = useRef<HTMLInputElement | null>(null);
  useBodyLock(true);
  useFocusTrap(true, panelRef, firstRef);
  const inv = state.mode === 'novo' ? null : state.inv;
  const position = inv ? positionOf(inv, today, cdi) : null;
  const meta = state.mode === 'novo' || state.mode === 'editar';

  const [name, setName] = useState(inv?.name ?? '');
  const [type, setType] = useState<InvestType>(inv?.type ?? 'cdb');
  const [institution, setInstitution] = useState(inv?.institution ?? '');
  const [rateKind, setRateKind] = useState<RateKind>(inv?.rateKind ?? 'cdi');
  const [rate, setRate] = useState(inv && inv.rateKind !== 'nenhuma' ? numInput(inv.rate) : '100');
  const [notes, setNotes] = useState(inv?.notes ?? '');
  const [amount, setAmount] = useState(state.mode === 'valor' && position ? formatBRLInput(Math.round(position.value * 100) / 100) : '');
  const [date, setDate] = useState(today);
  const [moves, setMoves] = useState(inv?.moves ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rateNum = parseNum(rate) ?? 0;
  const annual = annualRate({ rateKind, rate: rateNum }, cdi);
  const amountNum = parseBRL(amount);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (meta && !name.trim()) errs.name = 'Dê um nome, como “Reserva de emergência” ou “Tesouro Selic”.';
    if (meta && rateKind !== 'nenhuma' && (rateNum <= 0 || rateNum > 1000)) errs.rate = 'Informe a taxa, como 100 (% do CDI) ou 12 (% ao ano).';
    const needsAmount = state.mode !== 'editar';
    if (needsAmount && (amountNum === null || (state.mode !== 'valor' ? amountNum <= 0 : amountNum < 0))) errs.amount = 'Informe um valor, como 500,00.';
    if (needsAmount && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today)) errs.date = 'Informe uma data até hoje.';
    setErrors(errs);
    const first = ['name', 'rate', 'amount', 'date'].find((k) => errs[k]);
    if (first) {
      document.getElementById(`inv-${first}`)?.focus();
      return;
    }
    const base: Investment = inv ?? { id: newInvestId(), name: '', type, institution: '', rateKind, rate: 0, moves: [], current: null, notes: '' };
    const metaFields = meta
      ? { name: name.trim().slice(0, 80), type, institution: institution.trim().slice(0, 60), rateKind, rate: rateKind === 'nenhuma' ? 0 : rateNum, notes: notes.trim().slice(0, 280) }
      : {};
    const move = (kind: 'aporte' | 'resgate') => ({ id: newInvestId('m'), date, kind, amount: amountNum! });
    if (state.mode === 'novo') onSave({ ...base, ...metaFields, moves: [move('aporte')] }, `“${name.trim()}” adicionado à carteira`);
    else if (state.mode === 'editar') onSave({ ...base, ...metaFields, moves }, 'Investimento atualizado');
    else if (state.mode === 'aporte') onSave({ ...base, moves: [...base.moves, move('aporte')] }, `Aporte de ${brl2(amountNum!)} em “${base.name}” registrado`);
    else if (state.mode === 'resgate') onSave({ ...base, moves: [...base.moves, move('resgate')] }, `Resgate de ${brl2(amountNum!)} de “${base.name}” registrado`);
    else onSave({ ...base, current: { value: amountNum!, date, seen: base.moves.filter((m) => m.date <= date).map((m) => m.id) } }, `Valor de “${base.name}” atualizado`);
  };

  const err = (k: string) =>
    errors[k] ? (
      <span className="field-error" id={`inv-${k}-erro`}>
        <TriangleAlert size={13} aria-hidden="true" />
        {errors[k]}
      </span>
    ) : null;

  const preview =
    state.mode === 'valor' && position && amountNum !== null && position.invested > 0
      ? { gain: amountNum - position.invested, pct: (amountNum - position.invested) / position.invested }
      : null;

  return (
    <div className="overlay-root" data-leaving={leaving ? '' : undefined}>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className="drawer drawer-form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inv-titulo"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="drawer-head">
          <div>
            <p className="drawer-kicker">{inv ? inv.name : 'Investimentos'}</p>
            <h2 id="inv-titulo" className="drawer-title">
              {TITLES[state.mode]}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar formulário">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <form id="form-invest" className="drawer-body form" onSubmit={submit} noValidate>
          {state.mode !== 'editar' ? (
            <div className="field-row">
              <div className="field">
                <label htmlFor="inv-amount">{state.mode === 'novo' ? 'Quanto você aplicou' : state.mode === 'valor' ? 'Quanto vale hoje' : state.mode === 'resgate' ? 'Valor resgatado' : 'Valor do aporte'}</label>
                <span className="input-money">
                  <span aria-hidden="true">R$</span>
                  <input
                    ref={firstRef}
                    id="inv-amount"
                    className="input"
                    inputMode="decimal"
                    value={amount}
                    placeholder="0,00"
                    autoComplete="off"
                    aria-invalid={!!errors.amount || undefined}
                    aria-describedby={errors.amount ? 'inv-amount-erro' : undefined}
                    onChange={(e) => setAmount(e.target.value)}
                    onBlur={(e) => {
                      const v = parseBRL(e.target.value);
                      if (v !== null) setAmount(formatBRLInput(v));
                    }}
                  />
                </span>
                {err('amount')}
              </div>
              <div className="field">
                <label htmlFor="inv-date">{state.mode === 'valor' ? 'Conferido em' : 'Data'}</label>
                <input
                  id="inv-date"
                  type="date"
                  className="input"
                  max={today}
                  value={date}
                  aria-invalid={!!errors.date || undefined}
                  aria-describedby={errors.date ? 'inv-date-erro' : undefined}
                  onChange={(e) => setDate(e.target.value)}
                />
                {err('date')}
              </div>
            </div>
          ) : null}

          {state.mode === 'valor' ? (
            <p className="field-hint form-hint">
              Veja o saldo bruto no app do banco ou da corretora. A partir dele, o painel continua estimando pela taxa
              {inv && inv.rateKind !== 'nenhuma' ? ` (${rateText(inv)})` : ''}.
              {preview ? (
                <>
                  {' '}
                  Rendeu <strong className={preview.gain >= 0 ? 'num-pos' : 'num-neg'}>{signedBrl(preview.gain)}</strong> ({signedPct(preview.pct)}) sobre {brl2(position!.invested)} aplicados.
                </>
              ) : null}
            </p>
          ) : null}
          {state.mode === 'resgate' && position ? <p className="field-hint form-hint">Hoje vale cerca de {brl2(position.value)}.</p> : null}
          {state.mode === 'aporte' && position ? <p className="field-hint form-hint">Já aplicado: {brl2(position.invested)}. Hoje vale cerca de {brl2(position.value)}.</p> : null}

          {meta ? (
            <>
              <div className="field">
                <label htmlFor="inv-name">Nome</label>
                <input
                  ref={state.mode === 'editar' ? firstRef : undefined}
                  id="inv-name"
                  className="input"
                  list="inv-sugestoes"
                  value={name}
                  maxLength={80}
                  placeholder="Ex.: Reserva de emergência, Tesouro Selic"
                  autoComplete="off"
                  aria-invalid={!!errors.name || undefined}
                  aria-describedby={errors.name ? 'inv-name-erro' : undefined}
                  onChange={(e) => setName(e.target.value)}
                />
                <datalist id="inv-sugestoes">
                  {NAME_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                {err('name')}
              </div>

              <fieldset className="field">
                <legend>Tipo</legend>
                <div className="cat-grid">
                  {INVEST_ORDER.map((t) => {
                    const Icon = INVEST_ICON[t];
                    return (
                      <label key={t} className="cat-opt" title={INVEST_TYPES[t].hint}>
                        <input type="radio" name="inv-tipo" value={t} checked={type === t} onChange={() => setType(t)} />
                        <span>
                          <Icon size={16} strokeWidth={1.9} aria-hidden="true" style={{ color: INVEST_TYPES[t].color }} />
                          {INVEST_TYPES[t].label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="field">
                <label htmlFor="inv-rate">Rentabilidade</label>
                <Segmented
                  label="Como a taxa é informada"
                  value={rateKind}
                  options={(Object.keys(RATE_KINDS) as RateKind[]).map((k) => ({ value: k, label: k === 'nenhuma' ? 'Sem taxa' : RATE_KINDS[k].replace('% ', '') }))}
                  onChange={setRateKind}
                />
                {rateKind !== 'nenhuma' ? (
                  <>
                    <span className="input-money input-suffix">
                      <input
                        id="inv-rate"
                        className="input"
                        inputMode="decimal"
                        value={rate}
                        autoComplete="off"
                        aria-invalid={!!errors.rate || undefined}
                        aria-describedby={errors.rate ? 'inv-rate-erro' : 'inv-rate-dica'}
                        onChange={(e) => setRate(e.target.value)}
                      />
                      <span aria-hidden="true">{RATE_KINDS[rateKind]}</span>
                    </span>
                    {err('rate')}
                    <span className="field-hint" id="inv-rate-dica">
                      Equivale a {pct(annual)} ao ano, {pct(monthlyFromAnnual(annual), 3)} ao mês
                      {rateKind === 'cdi' ? ` (CDI de ${numInput(cdi)}%)` : ''}. Poupança rende perto de 6,17% ao ano.
                    </span>
                  </>
                ) : (
                  <span className="field-hint">Para ações, FIIs e cripto: use “Atualizar valor” de vez em quando para ver quanto rendeu.</span>
                )}
              </div>

              <div className="field">
                <label htmlFor="inv-inst">
                  Onde está <span className="opt">(opcional)</span>
                </label>
                <input id="inv-inst" className="input" value={institution} maxLength={60} placeholder="Banco ou corretora" autoComplete="off" onChange={(e) => setInstitution(e.target.value)} />
              </div>

              {state.mode === 'editar' ? (
                <div className="field">
                  <span className="legend-like">Histórico</span>
                  <ul className="inv-history">
                    {[...moves]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((m) => (
                        <li key={m.id}>
                          <span className="inv-history-kind" data-kind={m.kind}>
                            {m.kind === 'aporte' ? <ArrowDownToLine size={14} aria-hidden="true" /> : <ArrowUpFromLine size={14} aria-hidden="true" />}
                            {m.kind === 'aporte' ? 'Aporte' : 'Resgate'}
                          </span>
                          <span>{dmy(m.date)}</span>
                          <span className="strong">{brl2(m.amount)}</span>
                          <button type="button" className="icon-btn sm" onClick={() => setMoves((l) => l.filter((x) => x.id !== m.id))} aria-label={`Remover ${m.kind} de ${dmy(m.date)}`}>
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    {inv?.current ? (
                      <li>
                        <span className="inv-history-kind" data-kind="valor">
                          <RefreshCw size={14} aria-hidden="true" />
                          Conferido
                        </span>
                        <span>{dmy(inv.current.date)}</span>
                        <span className="strong">{brl2(inv.current.value)}</span>
                        <span />
                      </li>
                    ) : null}
                  </ul>
                  {!moves.length ? <span className="field-hint">Sem aportes: registre um aporte para o investimento contar.</span> : null}
                </div>
              ) : null}

              <div className="field">
                <label htmlFor="inv-notes">
                  Observação <span className="opt">(opcional)</span>
                </label>
                <textarea id="inv-notes" className="input" rows={2} maxLength={280} value={notes} placeholder="Vencimento, liquidez, objetivo" onChange={(e) => setNotes(e.target.value)} />
              </div>
            </>
          ) : null}
        </form>

        <footer className="drawer-foot form-foot">
          {confirmDelete && inv ? (
            <div className="discard" role="alert">
              <p>Excluir “{inv.name}” e todo o histórico?</p>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-danger" onClick={() => onDelete(inv)}>
                Excluir
              </button>
            </div>
          ) : (
            <>
              {state.mode === 'editar' ? (
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
                <button type="submit" form="form-invest" className="btn btn-primary">
                  {state.mode === 'novo' ? 'Adicionar' : state.mode === 'editar' ? 'Salvar alterações' : state.mode === 'valor' ? 'Atualizar' : 'Registrar'}
                </button>
              </div>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
