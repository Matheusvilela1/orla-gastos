// Formatação em pt-BR: moeda, números, percentuais e datas.

const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brl2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

const MINUS = '−';

const dec = (v: number, digits: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// Valores redondos ficam sem centavos ("R$ 2.600"); com centavos, eles sempre aparecem ("R$ 61,31").
const hasCents = (v: number) => Math.abs(v - Math.round(v)) >= 0.005;

export const fmt = {
  brl: (v: number) => (hasCents(v) ? brl2 : brl0).format(v),
  brl2: (v: number) => brl2.format(v),
  int: (v: number) => int.format(Math.round(v)),
  dec,
  compact: (v: number) => compact.format(v),
  /** "R$ 412,4 mil", "R$ 1,2 mi"; abaixo de mil, o valor exato ("R$ 61,31") */
  brlCompact: (v: number) => (Math.abs(v) < 1000 ? fmt.brl(v) : `R$ ${compact.format(v)}`),
  pct: (v: number, digits = 1) => `${dec(v * 100, digits)}%`,
  signedPct: (v: number, digits = 1) => {
    const s = v > 0 ? '+' : v < 0 ? MINUS : '';
    return `${s}${dec(Math.abs(v * 100), digits)}%`;
  },
  /** Diferença em pontos percentuais, ex.: "+0,12 p.p." */
  signedPp: (v: number, digits = 2) => {
    const s = v > 0 ? '+' : v < 0 ? MINUS : '';
    return `${s}${dec(Math.abs(v * 100), digits)} p.p.`;
  },
};

export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const WEEKDAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const pad = (n: number) => String(n).padStart(2, '0');

export const fmtDate = {
  /** "24 set" */
  dayMonth: (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`,
  /** "24 set 2026" */
  dayMonthYear: (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  /** "sex, 10 out 2026" */
  weekdayFull: (d: Date) => `${WEEKDAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  /** "14:03" */
  time: (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  /** "24 set a 23 out" ou "27 out 2025 a 23 out 2026" quando cruza o ano */
  range: (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear()
      ? `${fmtDate.dayMonth(a)} a ${fmtDate.dayMonth(b)}`
      : `${fmtDate.dayMonthYear(a)} a ${fmtDate.dayMonthYear(b)}`,
  /** "Hoje, 10:12", "Ontem, 21:40" ou "22 out, 14:03" */
  orderStamp: (d: Date, now: Date) => {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diff = Math.round((today - day) / 86400000);
    const prefix = diff === 0 ? 'Hoje' : diff === 1 ? 'Ontem' : fmtDate.dayMonth(d);
    return `${prefix}, ${fmtDate.time(d)}`;
  },
  /** "agora", "há 12 min", "há 3 h", "ontem" */
  relative: (d: Date, now: Date) => {
    const min = Math.round((now.getTime() - d.getTime()) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    return h < 48 ? 'ontem' : `há ${Math.round(h / 24)} dias`;
  },
};

/** Remove acentos e caixa para buscas tolerantes ("acucar" encontra "Açúcar"). */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

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
