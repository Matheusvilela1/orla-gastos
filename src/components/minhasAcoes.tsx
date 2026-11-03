import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Plus, Search, Trash2, TriangleAlert, X } from 'lucide-react';
import { buildPositions, fxSymbol, guessCurrency, newTradeId, qtyAt, quoteUnits, type StockPosition, type StockTrade, type TradeKind } from '../lib/acoes';
import { currencySymbol, formatMoney, knownName, shortSymbol, useOnline, useSymbolSearch, type Quote, type Ticker } from '../lib/bolsa';
import { isoDate, parseIso } from '../lib/finance';
import { useFinance } from '../lib/financeStore';
import { fmt, fmtDate, parseNum } from '../lib/format';
import { useBodyLock, useFocusTrap } from '../lib/hooks';
import { usePresence } from '../lib/motion';
import { useToast } from './toast';
import { Segmented, cx } from './ui';

const MINUS = '−';
const signed = (v: number, f: (n: number) => string) => (v > 0.005 ? '+' : v < -0.005 ? MINUS : '') + f(Math.abs(v));
const signedPct = (v: number) => (v > 0.00005 ? '+' : v < -0.00005 ? MINUS : '') + `${fmt.dec(Math.abs(v * 100), 2)}%`;
const toneOf = (v: number | null) => (v === null || Math.abs(v) < 0.005 ? 'flat' : v > 0 ? 'good' : 'bad');
const qtyText = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 8 });
const numInput = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 6, useGrouping: false });
const dmy = (iso: string) => fmtDate.dayMonthYear(parseIso(iso));
const brl2 = (v: number) => fmt.brl2(v);

/** Símbolos que a aba Bolsa precisa buscar para as ações da pessoa: as que ela tem e o câmbio delas. */
export function heldSymbols(trades: StockTrade[]): string[] {
  const out = new Set<string>();
  for (const p of buildPositions(trades)) {
    if (p.qtd <= 0) continue;
    out.add(p.simbolo);
    const fx = fxSymbol(p.moeda);
    if (fx) out.add(fx);
  }
  return [...out];
}

interface Live {
  /** Preço de agora, na moeda da posição. */
  price: number | null;
  prev: number | null;
  /** Reais por unidade da moeda (1 para real). */
  fx: number | null;
}

function liveOf(p: StockPosition, quotes: Record<string, Quote>): Live {
  const q = quotes[p.simbolo];
  const units = q ? quoteUnits(q.moeda) : null;
  const fxQ = fxSymbol(p.moeda);
  return {
    price: q && units ? q.preco * units.fator : null,
    prev: q?.anterior && units ? q.anterior * units.fator : null,
    fx: fxQ ? (quotes[fxQ]?.preco ?? null) : 1,
  };
}

// ---------------------------------------------------------------------------
// Seção na aba Bolsa

type Editor = { mode: 'nova'; tipo: TradeKind; ticker: Ticker | null } | { mode: 'editar'; trade: StockTrade } | { mode: 'ativo'; simbolo: string };

export function MyStocks({ quotes, onFocus }: { quotes: Record<string, Quote>; onFocus: (simbolo: string) => void }) {
  const fin = useFinance();
  const toast = useToast();
  const trades = fin.invest.trades;
  const positions = useMemo(() => buildPositions(trades), [trades]);
  const [editor, setEditor] = useState<(Editor & { nonce: number }) | null>(null);
  const [shown, leaving] = usePresence(editor, 240);
  const nonce = useRef(0);
  const open = (e: Editor) => setEditor({ ...e, nonce: ++nonce.current });

  const save = (next: StockTrade[], message: string) => {
    const previous = fin.saveInvest({ ...fin.invest, trades: next });
    toast(message, 'success', { action: { label: 'Desfazer', run: () => fin.saveInvest(previous) } });
  };

  const upsert = (t: StockTrade) => {
    const exists = trades.some((x) => x.id === t.id);
    save(exists ? trades.map((x) => (x.id === t.id ? t : x)) : [...trades, t], `${t.tipo === 'compra' ? 'Compra' : 'Venda'} de ${qtyText(t.qtd)} ${shortSymbol(t.simbolo)} ${exists ? 'atualizada' : 'registrada'}.`);
    onFocus(t.simbolo);
    setEditor({ mode: 'ativo', simbolo: t.simbolo, nonce: ++nonce.current });
  };

  const removeTrade = (t: StockTrade) => {
    const rest = trades.filter((x) => x.id !== t.id);
    save(rest, `Operação de ${dmy(t.data)} excluída.`);
    if (!rest.some((x) => x.simbolo === t.simbolo)) setEditor(null);
  };

  // Totais em reais, pelo câmbio de agora.
  const totals = useMemo(() => {
    let value = 0;
    let cost = 0;
    let day = 0;
    let realized = 0;
    let missing = 0;
    let foreign = false;
    for (const p of positions) {
      const live = liveOf(p, quotes);
      const fx = live.fx;
      if (p.moeda !== 'BRL') foreign = true;
      if (fx !== null) realized += p.realizado * fx;
      if (p.qtd <= 0) continue;
      if (live.price === null || fx === null) {
        missing++;
        continue;
      }
      value += p.qtd * live.price * fx;
      cost += p.custo * fx;
      if (live.prev !== null) day += p.qtd * (live.price - live.prev) * fx;
    }
    return { value, cost, result: value - cost, day, realized, missing, foreign, open: positions.filter((p) => p.qtd > 0).length };
  }, [positions, quotes]);

  const resultTone = toneOf(totals.result);

  return (
    <section className="sheet stocks-sheet" aria-labelledby="minhas-acoes">
      <div className="block">
        <div className="block-head">
          <div>
            <h2 className="card-title" id="minhas-acoes">
              Minhas ações
            </h2>
            <p className="block-sub">
              {positions.length
                ? `Lucro e prejuízo pela cotação de agora, sobre o preço médio de compra (com os custos).${totals.foreign ? ' Outras moedas viram reais pelo câmbio de agora.' : ''}`
                : 'Registre o que você comprou e acompanhe o lucro ou o prejuízo com a cotação ao vivo.'}
            </p>
          </div>
          <div className="block-actions">
            {positions.length ? (
              <button type="button" className="btn btn-secondary sm" onClick={() => open({ mode: 'nova', tipo: 'venda', ticker: null })}>
                <ArrowUpFromLine size={14} aria-hidden="true" />
                Registrar venda
              </button>
            ) : null}
            <button type="button" className="btn btn-primary sm" onClick={() => open({ mode: 'nova', tipo: 'compra', ticker: null })}>
              <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
              Registrar compra
            </button>
          </div>
        </div>

        {positions.length ? (
          <>
            <dl className="stocks-kpis">
              <div>
                <dt>Valor hoje</dt>
                <dd>{totals.open ? brl2(totals.value) : '—'}</dd>
                <span className="fin-kv-sub">{totals.open ? `pago: ${brl2(totals.cost)}` : 'nenhuma ação em carteira'}</span>
              </div>
              <div>
                <dt>Resultado</dt>
                <dd data-tone={resultTone}>{totals.open ? signed(totals.result, brl2) : '—'}</dd>
                <span className="fin-kv-sub">{totals.cost > 0 ? `${signedPct(totals.result / totals.cost)} sobre o que pagou` : 'ainda não vendido'}</span>
              </div>
              <div>
                <dt>Hoje</dt>
                <dd data-tone={toneOf(totals.day)}>{totals.open ? signed(totals.day, brl2) : '—'}</dd>
                <span className="fin-kv-sub">variação do dia</span>
              </div>
              {Math.abs(totals.realized) > 0.005 ? (
                <div>
                  <dt>Já realizado</dt>
                  <dd data-tone={toneOf(totals.realized)}>{signed(totals.realized, brl2)}</dd>
                  <span className="fin-kv-sub">nas vendas</span>
                </div>
              ) : null}
            </dl>
            {totals.missing ? (
              <p className="stocks-note">
                <TriangleAlert size={13} aria-hidden="true" />
                {totals.missing === 1 ? '1 ação está' : `${totals.missing} ações estão`} sem cotação agora e fora dos totais.
              </p>
            ) : null}

            <div className="pos-list" role="table" aria-label="Minhas ações">
              <div className="pos-row pos-head" role="row">
                <span role="columnheader">Ativo</span>
                <span role="columnheader">Cotas</span>
                <span role="columnheader">Preço médio</span>
                <span role="columnheader">Agora</span>
                <span role="columnheader">Valor hoje</span>
                <span role="columnheader">Resultado</span>
              </div>
              {positions.map((p) => (
                <PositionRow
                  key={p.simbolo}
                  p={p}
                  live={liveOf(p, quotes)}
                  onOpen={() => {
                    onFocus(p.simbolo);
                    open({ mode: 'ativo', simbolo: p.simbolo });
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="stocks-empty">
            <p>
              Exemplo: comprou <strong>100 PETR4 a R$ 38,00</strong>? Registre e o painel mostra quanto você ganhou ou perdeu, em reais e em %, a cada atualização.
            </p>
          </div>
        )}
      </div>

      {shown ? (
        <TradeDrawer
          key={shown.nonce}
          state={shown}
          leaving={leaving}
          trades={trades}
          positions={positions}
          quotes={quotes}
          onClose={() => setEditor(null)}
          onOpen={open}
          onSave={upsert}
          onDelete={removeTrade}
        />
      ) : null}
    </section>
  );
}

function PositionRow({ p, live, onOpen }: { p: StockPosition; live: Live; onOpen: () => void }) {
  const closed = p.qtd <= 0;
  const value = live.price !== null ? p.qtd * live.price : null;
  const result = value !== null ? value - p.custo : null;
  const pct = result !== null && p.custo > 0 ? result / p.custo : null;
  const day = live.price !== null && live.prev ? (live.price - live.prev) / live.prev : null;
  const tone = toneOf(closed ? p.realizado : result);
  const money = (v: number) => formatMoney(p.moeda, v);
  return (
    <button type="button" className="pos-row" role="row" data-closed={closed || undefined} onClick={onOpen} aria-label={`${shortSymbol(p.simbolo)}: ver operações`}>
      <span className="pos-id" role="cell">
        <strong>{shortSymbol(p.simbolo)}</strong>
        <span>{p.nome}</span>
      </span>
      <span className="pos-num" role="cell" data-label="Cotas">
        {closed ? 'vendida' : qtyText(p.qtd)}
      </span>
      <span className="pos-num" role="cell" data-label="Preço médio">
        {closed ? '—' : money(p.medio)}
      </span>
      <span className="pos-num" role="cell" data-label="Agora">
        {live.price !== null ? money(live.price) : '—'}
        {day !== null ? (
          <span className="pos-sub" data-tone={toneOf(day)}>
            {signedPct(day)} hoje
          </span>
        ) : null}
      </span>
      <span className="pos-num" role="cell" data-label="Valor hoje">
        {closed ? '—' : value !== null ? money(value) : '—'}
        {!closed && p.moeda !== 'BRL' && value !== null && live.fx !== null ? <span className="pos-sub">≈ {brl2(value * live.fx)}</span> : null}
      </span>
      <span className="pos-num pos-result" role="cell" data-label="Resultado" data-tone={tone}>
        {closed ? signed(p.realizado, money) : result !== null ? signed(result, money) : '—'}
        <span className="pos-sub">{closed ? 'realizado' : pct !== null ? signedPct(pct) : 'sem cotação'}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Gaveta: operações de um ativo, ou o formulário de compra/venda

function TradeDrawer({
  state,
  leaving,
  trades,
  positions,
  quotes,
  onClose,
  onOpen,
  onSave,
  onDelete,
}: {
  state: Editor;
  leaving: boolean;
  trades: StockTrade[];
  positions: StockPosition[];
  quotes: Record<string, Quote>;
  onClose: () => void;
  onOpen: (e: Editor) => void;
  onSave: (t: StockTrade) => void;
  onDelete: (t: StockTrade) => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  useBodyLock(true);
  useFocusTrap(true, panelRef);
  const pos = state.mode === 'ativo' ? positions.find((p) => p.simbolo === state.simbolo) : null;

  return (
    <div className="overlay-root" data-leaving={leaving ? '' : undefined}>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className="drawer drawer-form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acao-titulo"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="drawer-head">
          <div>
            <p className="drawer-kicker">Minhas ações</p>
            <h2 id="acao-titulo" className="drawer-title">
              {state.mode === 'ativo'
                ? `${shortSymbol(state.simbolo)}${pos ? ` · ${pos.nome}` : ''}`
                : state.mode === 'editar'
                  ? 'Editar operação'
                  : state.tipo === 'compra'
                    ? 'Registrar compra'
                    : 'Registrar venda'}
            </h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {state.mode === 'ativo' ? (
          pos ? (
            <AssetDetail pos={pos} live={liveOf(pos, quotes)} onOpen={onOpen} onDelete={onDelete} onClose={onClose} />
          ) : (
            <div className="drawer-body">
              <p className="block-sub">Este ativo não tem mais operações.</p>
            </div>
          )
        ) : (
          <TradeForm state={state} trades={trades} quotes={quotes} onCancel={onClose} onSave={onSave} />
        )}
      </aside>
    </div>
  );
}

function AssetDetail({ pos, live, onOpen, onDelete, onClose }: { pos: StockPosition; live: Live; onOpen: (e: Editor) => void; onDelete: (t: StockTrade) => void; onClose: () => void }) {
  const money = (v: number) => formatMoney(pos.moeda, v);
  const value = live.price !== null ? pos.qtd * live.price : null;
  const result = value !== null ? value - pos.custo : null;
  const ticker = { simbolo: pos.simbolo, nome: pos.nome };
  return (
    <>
      <div className="drawer-body">
        <dl className="fin-kv">
          <div>
            <dt>Cotas</dt>
            <dd>{qtyText(pos.qtd)}</dd>
          </div>
          {pos.qtd > 0 ? (
            <>
              <div>
                <dt>Preço médio</dt>
                <dd>{money(pos.medio)}</dd>
                <span className="fin-kv-sub">total pago: {money(pos.custo)}</span>
              </div>
              <div>
                <dt>Valor hoje</dt>
                <dd>{value !== null ? money(value) : '—'}</dd>
                <span className="fin-kv-sub">{live.price !== null ? `${money(live.price)} por cota` : 'sem cotação agora'}</span>
              </div>
              <div>
                <dt>Resultado</dt>
                <dd data-tone={toneOf(result)}>{result !== null ? signed(result, money) : '—'}</dd>
                <span className="fin-kv-sub">{result !== null && pos.custo > 0 ? `${signedPct(result / pos.custo)} sobre o preço médio` : ''}</span>
              </div>
            </>
          ) : null}
          {Math.abs(pos.realizado) > 0.005 ? (
            <div>
              <dt>Já realizado nas vendas</dt>
              <dd data-tone={toneOf(pos.realizado)}>{signed(pos.realizado, money)}</dd>
            </div>
          ) : null}
        </dl>

        <h3 className="card-title trade-hist-title">Operações</h3>
        <ul className="trade-hist">
          {[...pos.trades].reverse().map((t) => (
            <li key={t.id}>
              <button type="button" className="trade-op" onClick={() => onOpen({ mode: 'editar', trade: t })} aria-label={`Editar ${t.tipo} de ${dmy(t.data)}`}>
                <span className="trade-kind" data-kind={t.tipo}>
                  {t.tipo === 'compra' ? <ArrowDownToLine size={14} aria-hidden="true" /> : <ArrowUpFromLine size={14} aria-hidden="true" />}
                  {t.tipo === 'compra' ? 'Compra' : 'Venda'}
                </span>
                <span className="trade-what">
                  {qtyText(t.qtd)} × {formatMoney(t.moeda, t.preco)}
                  {t.taxas ? <span className="pos-sub">+ {formatMoney(t.moeda, t.taxas)} de custos</span> : null}
                </span>
                <span className="trade-date">{dmy(t.data)}</span>
              </button>
              <button type="button" className="icon-btn sm" onClick={() => onDelete(t)} aria-label={`Excluir ${t.tipo} de ${dmy(t.data)}`} title="Excluir operação">
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <footer className="drawer-foot form-foot">
        <div className="form-foot-right">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Fechar
          </button>
          {pos.qtd > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={() => onOpen({ mode: 'nova', tipo: 'venda', ticker })}>
              <ArrowUpFromLine size={15} aria-hidden="true" />
              Vender
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={() => onOpen({ mode: 'nova', tipo: 'compra', ticker })}>
            <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
            Comprar
          </button>
        </div>
      </footer>
    </>
  );
}

const KINDS = [
  { value: 'compra' as const, label: 'Compra' },
  { value: 'venda' as const, label: 'Venda' },
];

function TradeForm({
  state,
  trades,
  quotes,
  onCancel,
  onSave,
}: {
  state: Extract<Editor, { mode: 'nova' | 'editar' }>;
  trades: StockTrade[];
  quotes: Record<string, Quote>;
  onCancel: () => void;
  onSave: (t: StockTrade) => void;
}) {
  const online = useOnline();
  const today = isoDate(new Date());
  const editing = state.mode === 'editar' ? state.trade : null;
  const startTicker = editing ? { simbolo: editing.simbolo, nome: editing.nome } : state.mode === 'nova' ? state.ticker : null;
  const quoteNow = (s: string | undefined) => {
    const q = s ? quotes[s] : undefined;
    return q ? numInput(Math.round(q.preco * quoteUnits(q.moeda).fator * 100) / 100) : '';
  };

  const [ticker, setTicker] = useState<Ticker | null>(startTicker);
  const [tipo, setTipo] = useState<TradeKind>(editing?.tipo ?? (state.mode === 'nova' ? state.tipo : 'compra'));
  const [qtd, setQtd] = useState(editing ? numInput(editing.qtd) : '');
  const [preco, setPreco] = useState(editing ? numInput(editing.preco) : quoteNow(startTicker?.simbolo));
  const [taxas, setTaxas] = useState(editing?.taxas ? numInput(editing.taxas) : '');
  const [data, setData] = useState(editing?.data ?? today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const { results, state: searchState } = useSymbolSearch(search, !ticker);
  // Na venda, sugere os ativos que a pessoa tem.
  const owned = useMemo(() => buildPositions(trades).filter((p) => p.qtd > 0), [trades]);

  const q = ticker ? quotes[ticker.simbolo] : undefined;
  const moeda = editing?.moeda ?? (q ? quoteUnits(q.moeda).moeda : ticker ? guessCurrency(ticker.simbolo) : 'BRL');
  const qtdNum = parseNum(qtd);
  const precoNum = parseNum(preco);
  const taxasNum = taxas.trim() ? parseNum(taxas) : 0;
  const total = qtdNum && precoNum !== null ? qtdNum * precoNum + (tipo === 'compra' ? 1 : -1) * (taxasNum ?? 0) : null;
  const fxQ = fxSymbol(moeda);
  const fx = fxQ ? quotes[fxQ]?.preco ?? null : 1;
  const have = ticker ? qtyAt(trades, ticker.simbolo, data, editing?.id) : 0;
  const pos = ticker ? buildPositions(trades.filter((t) => t.id !== editing?.id)).find((p) => p.simbolo === ticker.simbolo) : undefined;
  const sellResult = tipo === 'venda' && pos && pos.qtd > 0 && qtdNum && precoNum !== null ? Math.min(qtdNum, pos.qtd) * (precoNum - pos.medio) - (taxasNum ?? 0) : null;

  const pick = (t: Ticker) => {
    setTicker(t);
    setSearch('');
    if (!preco) setPreco(quoteNow(t.simbolo));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!ticker) errs.ativo = 'Escolha a ação pela busca.';
    else if (ticker.simbolo.startsWith('^')) errs.ativo = 'Índices não podem ser comprados. Escolha uma ação, um ETF ou uma moeda.';
    if (qtdNum === null || qtdNum <= 0) errs.qtd = 'Informe quantas cotas, como 100 (ou 0,5 para frações).';
    else if (tipo === 'venda' && qtdNum > have + 1e-9) errs.qtd = have ? `Em ${dmy(data)} você tinha ${qtyText(have)} cotas.` : `Você não tinha ${ticker ? shortSymbol(ticker.simbolo) : 'esta ação'} em ${dmy(data)}.`;
    if (precoNum === null || precoNum <= 0) errs.preco = 'Informe o preço de cada cota, como 38,50.';
    if (taxasNum === null || taxasNum < 0) errs.taxas = 'Informe os custos, como 4,90, ou deixe em branco.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data > today) errs.data = 'Informe uma data até hoje.';
    setErrors(errs);
    const first = ['ativo', 'qtd', 'preco', 'taxas', 'data'].find((k) => errs[k]);
    if (first) {
      document.getElementById(`op-${first}`)?.focus();
      return;
    }
    onSave({
      id: editing?.id ?? newTradeId(),
      simbolo: ticker!.simbolo,
      nome: ticker!.nome.slice(0, 80),
      moeda,
      tipo,
      qtd: qtdNum!,
      preco: precoNum!,
      taxas: taxasNum ?? 0,
      data,
      createdAt: editing?.createdAt || new Date().toISOString(),
    });
  };

  const err = (k: string) =>
    errors[k] ? (
      <span className="field-error" id={`op-${k}-erro`}>
        <TriangleAlert size={13} aria-hidden="true" />
        {errors[k]}
      </span>
    ) : null;
  const sym = currencySymbol(moeda);

  return (
    <>
      <form id="form-operacao" className="drawer-body form" onSubmit={submit} noValidate>
        <div className="field">
          <span className="legend-like">Tipo</span>
          <Segmented label="Compra ou venda" value={tipo} options={KINDS} onChange={setTipo} />
        </div>

        <div className="field">
          <label htmlFor="op-ativo">Ativo</label>
          {ticker ? (
            <div className="op-ticker">
              <span>
                <strong>{shortSymbol(ticker.simbolo)}</strong> {ticker.nome}
              </span>
              {editing ? null : (
                <button type="button" className="btn btn-secondary sm" onClick={() => setTicker(null)}>
                  Trocar
                </button>
              )}
            </div>
          ) : (
            <>
              <label className="search-field">
                <Search size={15} aria-hidden="true" />
                <input
                  id="op-ativo"
                  type="search"
                  value={search}
                  autoFocus
                  autoComplete="off"
                  placeholder="Nome ou código, ex.: Petrobras, AAPL"
                  aria-invalid={!!errors.ativo || undefined}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="ticker-results op-results" role="list" aria-live="polite">
                {search.trim().length < 2 ? (
                  tipo === 'venda' && owned.length ? (
                    owned.map((p) => (
                      <button key={p.simbolo} type="button" role="listitem" className="ticker-opt" onClick={() => pick({ simbolo: p.simbolo, nome: p.nome })}>
                        <strong>{shortSymbol(p.simbolo)}</strong>
                        <span className="ticker-opt-name">{p.nome}</span>
                        <span className="ticker-opt-ex">{qtyText(p.qtd)} cotas</span>
                      </button>
                    ))
                  ) : (
                    <p className="ticker-note">Digite pelo menos 2 letras.</p>
                  )
                ) : !online ? (
                  <p className="ticker-note">Sem internet para buscar agora.</p>
                ) : searchState === 'buscando' ? (
                  <p className="ticker-note">Buscando…</p>
                ) : searchState === 'erro' ? (
                  <p className="ticker-note">A busca não respondeu. Tente de novo.</p>
                ) : !results.filter((r) => !r.simbolo.startsWith('^')).length ? (
                  <p className="ticker-note">Nada encontrado com “{search.trim()}”.</p>
                ) : (
                  results
                    .filter((r) => !r.simbolo.startsWith('^'))
                    .map((r) => (
                      <button key={r.simbolo} type="button" role="listitem" className="ticker-opt" onClick={() => pick({ simbolo: r.simbolo, nome: knownName(r.simbolo, r.nome) })}>
                        <strong>{shortSymbol(r.simbolo)}</strong>
                        <span className="ticker-opt-name">{r.nome}</span>
                        <span className="ticker-opt-ex">{r.bolsa}</span>
                      </button>
                    ))
                )}
              </div>
            </>
          )}
          {err('ativo')}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="op-qtd">Quantidade de cotas</label>
            <input
              id="op-qtd"
              className="input"
              inputMode="decimal"
              value={qtd}
              placeholder="100"
              autoComplete="off"
              aria-invalid={!!errors.qtd || undefined}
              aria-describedby={errors.qtd ? 'op-qtd-erro' : undefined}
              onChange={(e) => setQtd(e.target.value)}
            />
            {tipo === 'venda' && ticker && !errors.qtd ? <span className="field-hint">Você tinha {qtyText(have)} cotas nessa data.</span> : null}
            {err('qtd')}
          </div>
          <div className="field">
            <label htmlFor="op-preco">Preço por cota</label>
            <span className="input-money">
              <span aria-hidden="true">{sym}</span>
              <input
                id="op-preco"
                className="input"
                inputMode="decimal"
                value={preco}
                placeholder="0,00"
                autoComplete="off"
                aria-invalid={!!errors.preco || undefined}
                aria-describedby={errors.preco ? 'op-preco-erro' : undefined}
                onChange={(e) => setPreco(e.target.value)}
              />
            </span>
            {q && !errors.preco ? (
              <button type="button" className="field-link" onClick={() => setPreco(quoteNow(ticker?.simbolo))}>
                Usar a cotação de agora ({formatMoney(moeda, q.preco * quoteUnits(q.moeda).fator)})
              </button>
            ) : null}
            {err('preco')}
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="op-data">Data</label>
            <input id="op-data" type="date" className="input" value={data} max={today} aria-invalid={!!errors.data || undefined} onChange={(e) => setData(e.target.value)} />
            {err('data')}
          </div>
          <div className="field">
            <label htmlFor="op-taxas">
              Custos <span className="opt">(opcional)</span>
            </label>
            <span className="input-money">
              <span aria-hidden="true">{sym}</span>
              <input
                id="op-taxas"
                className="input"
                inputMode="decimal"
                value={taxas}
                placeholder="0,00"
                autoComplete="off"
                aria-invalid={!!errors.taxas || undefined}
                onChange={(e) => setTaxas(e.target.value)}
              />
            </span>
            <span className="field-hint">Corretagem, emolumentos e outras taxas.</span>
            {err('taxas')}
          </div>
        </div>

        {total !== null && total > 0 ? (
          <p className={cx('field-hint', 'form-hint')}>
            {tipo === 'compra' ? 'Total pago' : 'Total recebido'}: <strong>{formatMoney(moeda, total)}</strong>
            {moeda !== 'BRL' && fx !== null ? ` (≈ ${brl2(total * fx)} pelo câmbio de agora)` : ''}.
            {sellResult !== null ? (
              <>
                {' '}
                Sobre o preço médio de {formatMoney(moeda, pos!.medio)}, esta venda dá{' '}
                <strong data-tone={toneOf(sellResult)}>
                  {sellResult >= 0 ? 'lucro' : 'prejuízo'} de {formatMoney(moeda, Math.abs(sellResult))}
                </strong>
                .
              </>
            ) : null}
          </p>
        ) : null}
      </form>
      <footer className="drawer-foot form-foot">
        <div className="form-foot-right">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" form="form-operacao" className="btn btn-primary">
            {editing ? 'Salvar alterações' : tipo === 'compra' ? 'Registrar compra' : 'Registrar venda'}
          </button>
        </div>
      </footer>
    </>
  );
}
