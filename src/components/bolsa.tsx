import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CircleAlert, LoaderCircle, Plus, RefreshCw, RotateCcw, Search, TrendingDown, TrendingUp, Wifi, WifiOff, X } from 'lucide-react';
import {
  EXCHANGES,
  changeOf,
  exchangeById,
  exchangeTime,
  formatPrice,
  knownName,
  marketOpen,
  readPrefs,
  savePrefs,
  shortSymbol,
  tickersOf,
  useOnline,
  useQuotes,
  useSymbolSearch,
  type BolsaPrefs,
  type ExchangeId,
  type Quote,
  type QuoteStatus,
  type Ticker,
} from '../lib/bolsa';
import { IS_DEMO, useFinance } from '../lib/financeStore';
import { fmt, fmtDate } from '../lib/format';
import { useElementWidth } from '../lib/hooks';
import { spotlight } from '../lib/motion';
import { MyStocks, heldSymbols } from './minhasAcoes';
import { Poster } from './poster';
import { useToast } from './toast';
import { FloatingTip, Popover, cx, type TipState } from './ui';

const MINUS = '−';
const signedPct = (v: number) => (v > 0.00005 ? '+' : v < -0.00005 ? MINUS : '') + `${fmt.dec(Math.abs(v * 100), 2)}%`;
const toneOf = (v: number | null) => (v === null || Math.abs(v) < 0.00005 ? 'flat' : v > 0 ? 'good' : 'bad');

const ZONE_NAMES: Record<string, string> = {
  'America/Sao_Paulo': 'Brasília',
  'America/New_York': 'Nova York',
  'Europe/London': 'Londres',
  'Europe/Berlin': 'Frankfurt',
  'Asia/Tokyo': 'Tóquio',
  'Asia/Hong_Kong': 'Hong Kong',
  UTC: 'UTC',
};
const zoneName = (z: string) => ZONE_NAMES[z] ?? z.split('/').pop()?.replace(/_/g, ' ') ?? z;

/** Dia no fuso da bolsa: "3 nov". */
function exchangeDay(sec: number, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone }).format(sec * 1000).replace('.', '').replace(' de ', ' ');
  } catch {
    return '';
  }
}

/** "hoje, 14:35" ou "2 nov, 14:35" (no relógio deste computador). */
function stamp(ms: number, now: number) {
  const d = new Date(ms);
  return new Date(now).toDateString() === d.toDateString() ? `hoje, ${fmtDate.time(d)}` : `${fmtDate.dayMonth(d)}, ${fmtDate.time(d)}`;
}

// ---------------------------------------------------------------------------
// Tela

export function BolsaView() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<BolsaPrefs>(readPrefs);
  const ex = exchangeById(prefs.bolsa);
  const list = tickersOf(prefs, ex);
  const symbols = useMemo(() => [ex.main.simbolo, ...list.map((t) => t.simbolo).filter((s) => s !== ex.main.simbolo)], [ex, list]);
  // Também as ações da pessoa (e o câmbio delas), para o lucro e o prejuízo.
  const trades = useFinance().invest.trades;
  const held = useMemo(() => heldSymbols(trades), [trades]);
  const fetchList = useMemo(() => [...new Set([...symbols, ...held])], [symbols, held]);
  const { quotes, at, status, failed, busy, refresh } = useQuotes(fetchList);
  const [focus, setFocus] = useState<string | null>(null);
  const shown = focus && fetchList.includes(focus) ? focus : ex.main.simbolo;
  const nameOf = (s: string) =>
    (s === ex.main.simbolo ? ex.main.nome : list.find((t) => t.simbolo === s)?.nome) ?? trades.find((t) => t.simbolo === s)?.nome ?? quotes[s]?.nome ?? s;

  const update = (p: BolsaPrefs) => {
    setPrefs(p);
    savePrefs(p);
  };
  const pick = (id: ExchangeId) => {
    update({ ...prefs, bolsa: id });
    setFocus(null);
  };
  // Igual à lista padrão volta a não ser guardada, para receber as mudanças da padrão.
  const setList = (next: Ticker[]) => {
    const listas = { ...prefs.listas, [ex.id]: next };
    if (next.map((t) => t.simbolo).join() === ex.tickers.map((t) => t.simbolo).join()) delete listas[ex.id];
    update({ ...prefs, listas });
  };
  const customized = !!prefs.listas[ex.id];

  const add = (t: Ticker) => {
    if (symbols.includes(t.simbolo)) {
      toast(`${shortSymbol(t.simbolo)} já está na lista.`, 'info');
    } else {
      setList([...list, t]);
      toast(`${shortSymbol(t.simbolo)} adicionado em ${ex.label}.`, 'success');
    }
    setFocus(t.simbolo);
  };
  const remove = (t: Ticker) => {
    const previous = prefs;
    setList(list.filter((x) => x.simbolo !== t.simbolo));
    toast(`${shortSymbol(t.simbolo)} saiu da lista.`, 'success', { action: { label: 'Desfazer', run: () => update(previous) } });
  };
  const reset = () => {
    const previous = prefs;
    const listas = { ...prefs.listas };
    delete listas[ex.id];
    update({ ...prefs, listas });
    toast(`Lista de ${ex.label} voltou à padrão.`, 'success', { action: { label: 'Desfazer', run: () => update(previous) } });
  };

  const main = quotes[ex.main.simbolo];
  const mainChange = main ? changeOf(main) : null;
  const mainOpen = main ? marketOpen(main, Date.now()) : null;
  const shownQuote = quotes[shown];

  return (
    <>
      <Poster
        kicker={`Bolsa · ${ex.label}`}
        lines={main && mainChange !== null ? [{ text: ex.main.nome }, { text: signedPct(mainChange), accent: true }] : [{ text: 'Acompanhe' }, { text: 'a bolsa.', accent: true }]}
        sub={
          main
            ? `${formatPrice(main, main.preco)}${mainOpen === null ? '' : mainOpen ? ' · pregão aberto agora' : ' · pregão fechado, valores do último pregão'}.`
            : 'Cotações ao vivo das bolsas do mundo, sempre que o painel estiver conectado à internet.'
        }
      />

      <div className="fin-bar bolsa-bar">
        <div className="chips bolsa-picker" role="group" aria-label="Bolsa">
          {EXCHANGES.map((e) => (
            <button key={e.id} type="button" className="chip" aria-pressed={e.id === ex.id} title={e.place} onClick={() => pick(e.id)}>
              {e.label}
            </button>
          ))}
        </div>
        <div className="fin-bar-actions">
          <LiveChip status={status} at={at} />
          <button type="button" className="icon-btn" onClick={refresh} disabled={busy} aria-label="Atualizar cotações" title="Atualizar cotações">
            <RefreshCw size={16} className={busy ? 'spin' : undefined} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid fin-grid bolsa-grid">
        <ConnectionAlert status={status} at={at} hasData={!!Object.keys(quotes).length} onRetry={refresh} />

        <MyStocks quotes={quotes} onFocus={setFocus} />

        <section className="sheet sheet-fin-hero" aria-labelledby="bolsa-destaque" onPointerMove={spotlight}>
          <QuoteSummary q={shownQuote} name={nameOf(shown)} symbol={shown} loading={status === 'carregando'} />
          <div className="fin-chart">
            <IntradayChart q={shownQuote} name={nameOf(shown)} />
          </div>
        </section>

        <section className="sheet sheet-ledger" aria-labelledby="bolsa-lista">
          <div className="block">
            <div className="block-head">
              <div>
                <h2 className="card-title" id="bolsa-lista">
                  Acompanhando em {ex.label}
                </h2>
                <p className="block-sub">Clique numa linha para ver o gráfico do dia. {ex.place}.</p>
              </div>
              <div className="block-actions">
                {customized ? (
                  <button type="button" className="btn btn-secondary sm" onClick={reset}>
                    <RotateCcw size={14} aria-hidden="true" />
                    Lista padrão
                  </button>
                ) : null}
                <AddTicker onAdd={add} />
              </div>
            </div>

            <ul className="quote-list">
              {[ex.main, ...list.filter((t) => t.simbolo !== ex.main.simbolo)].map((t) => (
                <QuoteRow
                  key={t.simbolo}
                  ticker={t}
                  q={quotes[t.simbolo]}
                  failed={failed.includes(t.simbolo)}
                  selected={t.simbolo === shown}
                  isMain={t.simbolo === ex.main.simbolo}
                  onSelect={() => setFocus(t.simbolo)}
                  onRemove={() => remove(t)}
                />
              ))}
            </ul>
            {!list.length ? <p className="block-sub">Nenhuma ação na lista. Use “Adicionar” para buscar pelo nome ou pelo código.</p> : null}
          </div>
        </section>

        <p className="bolsa-foot">
          Cotações do Yahoo Finanças, com atraso de até 15 minutos em algumas bolsas. Horários no fuso de cada bolsa. Só informativo: não é recomendação de investimento.
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Situação da conexão

function LiveChip({ status, at }: { status: QuoteStatus; at: number | null }) {
  const now = Date.now();
  if (status === 'carregando')
    return (
      <span className="sync-chip">
        <LoaderCircle size={14} className="spin" aria-hidden="true" />
        Conectando
      </span>
    );
  if (status === 'ao-vivo')
    return (
      <span className="sync-chip" data-tone="live" title="Atualiza sozinho a cada minuto">
        <span className="live-dot" aria-hidden="true" />
        Ao vivo{at ? ` · ${fmtDate.time(new Date(at))}` : ''}
      </span>
    );
  const offline = status === 'sem-internet';
  return (
    <span className="sync-chip" data-tone={status === 'erro' ? 'critical' : 'warning'} title={at ? `Últimas cotações: ${stamp(at, now)}` : undefined}>
      {offline ? <WifiOff size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
      {offline ? 'Sem internet' : status === 'sem-servidor' ? 'Sem servidor' : 'Fonte fora do ar'}
    </span>
  );
}

function ConnectionAlert({ status, at, hasData, onRetry }: { status: QuoteStatus; at: number | null; hasData: boolean; onRetry: () => void }) {
  if (status === 'carregando' || status === 'ao-vivo') return null;
  const last = at && hasData ? ` Mostrando as últimas cotações, de ${stamp(at, Date.now())}.` : '';
  let title: string;
  let text: string;
  if (status === 'sem-internet') {
    title = 'Você está sem internet.';
    text = `As cotações são a única parte do painel que precisa de conexão; o resto continua funcionando.${last}`;
  } else if (status === 'sem-servidor') {
    title = IS_DEMO ? 'Na demonstração online não há cotações ao vivo.' : 'O servidor do painel não respondeu.';
    text = IS_DEMO ? 'Elas vêm pelo servidor do painel. Baixe o projeto e rode no seu computador para ver.' : `Abra o Orla pelo Iniciar.bat para ver as cotações.${last}`;
  } else {
    title = 'O Yahoo Finanças não respondeu.';
    text = `Tente de novo em alguns minutos.${last}`;
  }
  return (
    <section className="fin-alerts" aria-label="Conexão">
      <div className="fin-alert" data-tone="warning" role="status">
        <span className="fin-alert-icon">{status === 'sem-internet' ? <WifiOff size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}</span>
        <p>
          <strong>{title}</strong> {text}
        </p>
        {IS_DEMO && status === 'sem-servidor' ? null : (
          <button type="button" className="btn btn-secondary sm" onClick={onRetry}>
            <Wifi size={14} aria-hidden="true" />
            Tentar de novo
          </button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Destaque: o índice da bolsa ou a ação escolhida

function dayRange(q: Quote) {
  if (!q.pontos.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, v] of q.pontos) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo: Math.min(lo, q.preco), hi: Math.max(hi, q.preco) };
}

function QuoteSummary({ q, name, symbol, loading }: { q: Quote | undefined; name: string; symbol: string; loading: boolean }) {
  const change = q ? changeOf(q) : null;
  const tone = toneOf(change);
  const range = q ? dayRange(q) : null;
  const open = q ? marketOpen(q, Date.now()) : null;
  const Icon = tone === 'bad' ? TrendingDown : TrendingUp;
  return (
    <div className="fin-summary">
      <div className="fin-summary-head">
        <h2 className="card-title" id="bolsa-destaque">
          {name}
        </h2>
        <span className="tag">{shortSymbol(symbol)}</span>
        {open !== null ? (
          <span className="market-tag" data-open={open || undefined}>
            {open ? 'aberto' : 'fechado'}
          </span>
        ) : null}
      </div>
      {q ? (
        <>
          <p className="hero-figure">
            <span className="hero-value">{formatPrice(q, q.preco)}</span>
            {change !== null ? (
              <span className="delta" data-tone={tone}>
                <Icon size={14} strokeWidth={2.4} aria-hidden="true" />
                <span>{signedPct(change)}</span>
              </span>
            ) : null}
          </p>
          <p className="hero-caption">
            {q.anterior
              ? `${q.preco >= q.anterior ? 'Subiu' : 'Caiu'} ${formatPrice(q, Math.abs(q.preco - q.anterior))} desde o fechamento anterior, de ${formatPrice(q, q.anterior)}.`
              : 'Sem o fechamento anterior para comparar.'}
          </p>
          <dl className="fin-kv">
            {range ? (
              <>
                <div>
                  <dt>Máxima do dia</dt>
                  <dd>{formatPrice(q, range.hi)}</dd>
                </div>
                <div>
                  <dt>Mínima do dia</dt>
                  <dd>{formatPrice(q, range.lo)}</dd>
                </div>
              </>
            ) : null}
            {q.hora ? (
              <div>
                <dt>Última negociação</dt>
                <dd>{exchangeTime(q.hora, q.fuso)}</dd>
                <span className="fin-kv-sub">horário de {zoneName(q.fuso)}</span>
              </div>
            ) : null}
          </dl>
        </>
      ) : (
        <p className="hero-caption">{loading ? 'Buscando a cotação…' : 'Sem cotação para mostrar agora.'}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gráfico do dia, com cursor e tooltip

const CHART_H = 240;
const PAD = { top: 18, right: 12, bottom: 26, left: 12 };

function IntradayChart({ q, name }: { q: Quote | undefined; name: string }) {
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const pts = q?.pontos ?? [];

  useEffect(() => {
    setCursor(null);
    setTip(null);
  }, [q?.simbolo]);

  const geo = useMemo(() => {
    if (!q || pts.length < 2 || width < 40) return null;
    // O pregão informado pode ser o do dia seguinte (bolsa fechada): só vale se começa junto com os pontos.
    const first = pts[0][0];
    const last = pts[pts.length - 1][0];
    const len = q.abre !== null && q.fecha !== null && q.fecha > q.abre ? q.fecha - q.abre : 0;
    const sameDay = q.abre !== null && q.abre <= first + 3600 && q.abre >= first - 7200;
    const t0 = sameDay && q.abre !== null ? Math.min(q.abre, first) : first;
    const t1 = Math.max(last, t0 + len);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [, v] of pts) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (q.anterior) {
      lo = Math.min(lo, q.anterior);
      hi = Math.max(hi, q.anterior);
    }
    const pad = (hi - lo || hi * 0.01 || 1) * 0.08;
    lo -= pad;
    hi += pad;
    const w = width - PAD.left - PAD.right;
    const h = CHART_H - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * w;
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * h;
    const line = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const area = `${line}L${x(pts[pts.length - 1][0]).toFixed(1)},${PAD.top + h}L${x(pts[0][0]).toFixed(1)},${PAD.top + h}Z`;
    return { t0, t1, x, y, line, area, base: q.anterior ? y(q.anterior) : null, bottom: PAD.top + h };
  }, [q, pts, width]);

  const change = q ? changeOf(q) : null;
  const tone = toneOf(change);
  const open = q ? marketOpen(q, Date.now()) : null;
  const day = q && pts.length ? exchangeDay(pts[pts.length - 1][0], q.fuso) : '';

  const show = (i: number) => {
    if (!q || !geo || !boxRef.current || !svgRef.current) return;
    const [t, v] = pts[i];
    const top = svgRef.current.getBoundingClientRect().top - boxRef.current.getBoundingClientRect().top;
    const half = 80;
    const px = Math.min(Math.max(geo.x(t), half), Math.max(half, width - half));
    const vs = q.anterior ? (v - q.anterior) / q.anterior : null;
    setCursor(i);
    setTip({
      x: px,
      y: top + geo.y(v),
      content: (
        <>
          <strong>{formatPrice(q, v)}</strong>
          <span className="ftip-sub">
            {exchangeTime(t, q.fuso)}
            {vs !== null ? ` · ${signedPct(vs)} no dia` : ''}
          </span>
        </>
      ),
    });
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!geo) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0;
    let dist = Infinity;
    pts.forEach(([t], i) => {
      const d = Math.abs(geo.x(t) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    show(best);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!pts.length) return;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      show(e.key === 'Home' ? 0 : pts.length - 1);
    } else if (step) {
      e.preventDefault();
      show(Math.min(pts.length - 1, Math.max(0, (cursor ?? pts.length - 1) + step)));
    }
  };

  const hide = () => {
    setCursor(null);
    setTip(null);
  };

  const label =
    q && pts.length
      ? `Gráfico do dia de ${name}: de ${formatPrice(q, pts[0][1])} às ${exchangeTime(pts[0][0], q.fuso)} até ${formatPrice(q, pts[pts.length - 1][1])} às ${exchangeTime(pts[pts.length - 1][0], q.fuso)}. Use as setas para percorrer.`
      : `Gráfico do dia de ${name}`;

  return (
    <div className="bolsa-chart" ref={boxRef} data-tone={tone}>
      <div className="bolsa-chart-head">
        <h3 className="card-title">{open === false ? `Último pregão${day ? ` · ${day}` : ''}` : 'Hoje'}</h3>
        <p className="block-sub">{q ? `A cada 5 minutos, no horário de ${zoneName(q.fuso)}` : 'Preço ao longo do dia'}</p>
      </div>
      {geo && q ? (
        <svg
          ref={svgRef}
          className="bolsa-svg"
          width={width}
          height={CHART_H}
          viewBox={`0 0 ${width} ${CHART_H}`}
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={hide}
          onKeyDown={onKey}
          onBlur={hide}
        >
          <defs>
            <linearGradient id="bolsa-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className="bolsa-fill-top" />
              <stop offset="100%" className="bolsa-fill-bottom" />
            </linearGradient>
          </defs>
          <line className="bolsa-axis" x1={PAD.left} x2={width - PAD.right} y1={geo.bottom} y2={geo.bottom} />
          {geo.base !== null ? (
            <>
              <line className="bolsa-base" x1={PAD.left} x2={width - PAD.right} y1={geo.base} y2={geo.base} />
              <text className="bolsa-base-label" x={width - PAD.right} y={geo.base - 6} textAnchor="end">
                fechamento anterior
              </text>
            </>
          ) : null}
          <path className="bolsa-area" d={geo.area} fill="url(#bolsa-fill)" />
          <path className="bolsa-line" d={geo.line} />
          {cursor !== null ? (
            <>
              <line className="bolsa-cross" x1={geo.x(pts[cursor][0])} x2={geo.x(pts[cursor][0])} y1={PAD.top} y2={geo.bottom} />
              <circle className="bolsa-dot" cx={geo.x(pts[cursor][0])} cy={geo.y(pts[cursor][1])} r={5} />
            </>
          ) : (
            <circle className="bolsa-dot" cx={geo.x(pts[pts.length - 1][0])} cy={geo.y(pts[pts.length - 1][1])} r={4} />
          )}
          <text className="bolsa-tick" x={PAD.left} y={CHART_H - 6}>
            {exchangeTime(geo.t0, q.fuso)}
          </text>
          <text className="bolsa-tick" x={width - PAD.right} y={CHART_H - 6} textAnchor="end">
            {exchangeTime(geo.t1, q.fuso)}
          </text>
        </svg>
      ) : (
        <div className="bolsa-empty" style={{ height: CHART_H }}>
          {q ? 'Ainda sem negociações hoje.' : 'O gráfico aparece quando a cotação chegar.'}
        </div>
      )}
      <FloatingTip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista acompanhada

function Sparkline({ q }: { q: Quote }) {
  const pts = q.pontos;
  if (pts.length < 2) return <span className="spark" aria-hidden="true" />;
  const W = 96;
  const H = 30;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, v] of pts) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (q.anterior) {
    lo = Math.min(lo, q.anterior);
    hi = Math.max(hi, q.anterior);
  }
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  const x = (t: number) => 1 + ((t - t0) / (t1 - t0 || 1)) * (W - 2);
  const y = (v: number) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (H - 4);
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {q.anterior ? <line className="spark-base" x1={0} x2={W} y1={y(q.anterior)} y2={y(q.anterior)} /> : null}
      <path className="spark-line" d={pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('')} />
    </svg>
  );
}

function QuoteRow({
  ticker,
  q,
  failed,
  selected,
  isMain,
  onSelect,
  onRemove,
}: {
  ticker: Ticker;
  q: Quote | undefined;
  failed: boolean;
  selected: boolean;
  isMain: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const change = q ? changeOf(q) : null;
  const tone = toneOf(change);
  return (
    <li className="quote-item" data-tone={tone}>
      <button type="button" className="quote-row" aria-pressed={selected} onClick={onSelect}>
        <span className="quote-id">
          <strong>{shortSymbol(ticker.simbolo)}</strong>
          <span>{ticker.nome}</span>
        </span>
        {q ? <Sparkline q={q} /> : <span className="spark" aria-hidden="true" />}
        <span className="quote-price">{q ? formatPrice(q, q.preco) : failed ? 'sem cotação' : '—'}</span>
        <span className={cx('delta', 'quote-delta')} data-tone={tone}>
          {change !== null ? signedPct(change) : '—'}
        </span>
      </button>
      {isMain ? (
        <span className="quote-remove-space" aria-hidden="true" />
      ) : (
        <button type="button" className="icon-btn sm quote-remove" onClick={onRemove} aria-label={`Tirar ${shortSymbol(ticker.simbolo)} da lista`} title="Tirar da lista">
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Adicionar pela busca

function AddTicker({ onAdd }: { onAdd: (t: Ticker) => void }) {
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { results, state } = useSymbolSearch(q, open);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setQ('');
  };

  return (
    <div className="add-ticker" ref={anchorRef}>
      <button type="button" className="btn btn-primary sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
        Adicionar
      </button>
      <Popover open={open} onClose={close} anchorRef={anchorRef} label="Adicionar à lista" className="ticker-pop">
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && close()}
            placeholder="Nome ou código, ex.: Itaú, AAPL"
            aria-label="Buscar ação, índice ou moeda"
          />
        </label>
        <div className="ticker-results" role="list" aria-live="polite">
          {!online ? (
            <p className="ticker-note">Sem internet para buscar agora.</p>
          ) : state === 'buscando' ? (
            <p className="ticker-note">Buscando…</p>
          ) : state === 'erro' ? (
            <p className="ticker-note">A busca não respondeu. Tente de novo.</p>
          ) : state === 'pronto' && !results.length ? (
            <p className="ticker-note">Nada encontrado com “{q.trim()}”.</p>
          ) : state === 'idle' ? (
            <p className="ticker-note">Digite pelo menos 2 letras.</p>
          ) : (
            results.map((r) => (
              <button
                key={r.simbolo}
                type="button"
                role="listitem"
                className="ticker-opt"
                onClick={() => {
                  onAdd({ simbolo: r.simbolo, nome: knownName(r.simbolo, r.nome) });
                  close();
                }}
              >
                <strong>{shortSymbol(r.simbolo)}</strong>
                <span className="ticker-opt-name">{r.nome}</span>
                <span className="ticker-opt-ex">{r.bolsa}</span>
              </button>
            ))
          )}
        </div>
      </Popover>
    </div>
  );
}
