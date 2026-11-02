import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';

/** Curvas e durações usadas pelas animações feitas em JS (as do CSS ficam em styles.css). */
export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Último ponto clicado: a troca de tema se abre em círculo a partir dele.
let lastPointer: { x: number; y: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (lastPointer = { x: e.clientX, y: e.clientY }), { capture: true, passive: true });
}

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

/**
 * Troca o tema com uma revelação circular (View Transitions). Sem suporte ou com
 * movimento reduzido, troca na hora.
 */
export function revealThemeChange(apply: () => void) {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || prefersReducedMotion()) {
    apply();
    return;
  }
  const x = lastPointer?.x ?? window.innerWidth - 40;
  const y = lastPointer?.y ?? 32;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const root = document.documentElement;
  root.style.setProperty('--vt-x', `${x}px`);
  root.style.setProperty('--vt-y', `${y}px`);
  root.style.setProperty('--vt-r', `${r}px`);
  root.dataset.themeSwap = '';
  doc
    .startViewTransition(() => flushSync(apply))
    .finished.finally(() => delete root.dataset.themeSwap);
}

/**
 * Mantém algo montado por `ms` depois de sumir, para a animação de saída rodar.
 * Devolve o último valor presente e se ele está saindo.
 */
export function usePresence<T>(value: T | null | undefined | false, ms = 220): [T | null, boolean] {
  const [shown, setShown] = useState<T | null>(value || null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (value) {
      setShown(value);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    if (prefersReducedMotion()) {
      setShown(null);
      return;
    }
    setLeaving(true);
    const t = window.setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, ms);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms]);
  return [value || shown, leaving && !value];
}

/**
 * Ao trocar de mês, o conteúdo entra deslizando do lado para onde o mês andou
 * (para a direita quando avança, para a esquerda quando volta).
 */
export function useMonthSlide(ref: RefObject<HTMLElement | null>, month: string, selector: string) {
  const previous = useRef(month);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = month;
    if (from === month || !ref.current || prefersReducedMotion()) return;
    const dir = month > from ? 1 : -1;
    ref.current.querySelectorAll<HTMLElement>(selector).forEach((el, i) => {
      el.animate(
        [
          { opacity: 0, transform: `translateX(${dir * 22}px)`, filter: 'blur(3px)' },
          { opacity: 1, transform: 'none', filter: 'none' },
        ],
        { duration: 460, delay: i * 45, easing: EASE_OUT, fill: 'backwards' },
      );
    });
  }, [month, ref, selector]);
}

/**
 * Marca com `data-in` cada elemento de `selector` dentro de `ref` quando ele entra
 * na tela (o CSS faz a entrada). `deps` refaz a busca quando a lista muda.
 */
export function useRevealOnScroll(ref: RefObject<HTMLElement | null>, selector: string, deps: unknown[]) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => !el.hasAttribute('data-in'));
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      items.forEach((el) => el.setAttribute('data-in', ''));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute('data-in', '');
          io.unobserve(e.target);
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Luz que acompanha o ponteiro (usa --mx e --my no elemento). */
export function spotlight(e: ReactPointerEvent<HTMLElement>) {
  if (e.pointerType !== 'mouse') return;
  const el = e.currentTarget;
  const box = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - box.left}px`);
  el.style.setProperty('--my', `${e.clientY - box.top}px`);
}
