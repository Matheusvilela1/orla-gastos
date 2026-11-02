import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { fmt } from '../lib/format';
import { useDismiss } from '../lib/hooks';

/** Permite passar variáveis CSS no style sem brigar com os tipos. */
export const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <path d="M9 17.5a7 7 0 0 1 14 0z" fill="var(--accent)" />
      <path d="M6.5 21.5c3.2 0 3.2-1.8 6.3-1.8s3.2 1.8 6.4 1.8 3.2-1.8 6.3-1.8" fill="none" stroke="var(--surface)" strokeWidth="2" strokeLinecap="round" />
      <path d="M6.5 26c3.2 0 3.2-1.8 6.3-1.8s3.2 1.8 6.4 1.8 3.2-1.8 6.3-1.8" fill="none" stroke="var(--surface)" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const parts = name.split(' ');
  const initials = (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  // Tom estável por nome, sempre neutro: o avatar não carrega significado de dados.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="avatar" data-tone={h % 4} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------------------

export function Delta({ value, kind = 'pct', goodWhenUp = true }: { value: number; kind?: 'pct' | 'pp'; goodWhenUp?: boolean }) {
  const dir = Math.abs(value) < 0.0005 ? 'flat' : value > 0 ? 'up' : 'down';
  const tone = dir === 'flat' ? 'flat' : (dir === 'up') === goodWhenUp ? 'good' : 'bad';
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : ArrowRight;
  const text = kind === 'pp' ? fmt.signedPp(value) : fmt.signedPct(value);
  return (
    <span className="delta" data-tone={tone}>
      <Icon size={14} strokeWidth={2.4} aria-hidden="true" />
      <span>{text}</span>
      <span className="sr-only">{dir === 'up' ? ' de alta' : dir === 'down' ? ' de queda' : ' de variação'} sobre o período anterior</span>
    </span>
  );
}

// ---------------------------------------------------------------------------

export interface SegOption<T extends string> {
  value: T;
  label: string;
}

/** Controle segmentado acessível (setas do teclado mudam a opção). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  id,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  label: string;
  id?: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (index + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className="seg" id={id} role="radiogroup" aria-label={label} onKeyDown={onKey} style={cssVars({ '--seg-count': options.length, '--seg-index': index })}>
      <span className="seg-thumb" aria-hidden="true" />
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          className="seg-opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Popover({
  open,
  onClose,
  anchorRef,
  label,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(open, [ref, anchorRef], onClose);
  if (!open) return null;
  return (
    <div ref={ref} className={cx('popover', className)} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Tooltip flutuante para gráficos feitos em HTML (posição relativa ao container). */
export function FloatingTip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div className="ftip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.content}
    </div>
  );
}

/** Calcula a posição do tooltip acima de um elemento, presa às bordas do container. */
export function tipPosition(target: Element, container: Element, half = 92) {
  const r = target.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  const x = r.left + r.width / 2 - c.left;
  return { x: Math.min(Math.max(x, half), Math.max(half, c.width - half)), y: r.top - c.top };
}

export function LineKey({ color }: { color: string }) {
  return <span className="linekey" style={{ background: color }} aria-hidden="true" />;
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} aria-hidden="true" />;
}

export function Skeleton({ w = '100%', h = 14, r = 6 }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
