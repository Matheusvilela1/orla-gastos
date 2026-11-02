import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** localStorage com tolerância a falhas (aba anônima, armazenamento bloqueado). */
export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* sem armazenamento: a preferência vale só para esta visita */
    }
  },
};

export function useMediaQuery(query: string): boolean {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/** Largura atual de um elemento (ResizeObserver). */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Anima um número até o novo valor quando ele muda (sem animar no primeiro render). */
export function useCountUp(target: number, duration = 600): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  const current = useRef(target);
  current.current = value;
  useEffect(() => {
    const from = current.current;
    if (reduced || from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);
  return value;
}

export type ThemePref = 'system' | 'light' | 'dark' | 'neon';

const THEME_PREFS: ThemePref[] = ['system', 'light', 'dark', 'neon'];

/**
 * Tema claro, escuro ou neon (um escuro azul-marinho com rosa). Em "sistema" a
 * página devolve o controle a quem a hospeda (o atributo data-theme original da
 * raiz) ou ao prefers-color-scheme.
 */
export function useTheme() {
  const hostTheme = useRef<string | null>(null);
  const [pref, setPrefState] = useState<ThemePref>(() => {
    const saved = storage.get<ThemePref>('orla.theme', 'system');
    return THEME_PREFS.includes(saved) ? saved : 'system';
  });
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (hostTheme.current === null) hostTheme.current = root.getAttribute('data-theme') ?? '';
    if (pref === 'system') {
      if (hostTheme.current) root.setAttribute('data-theme', hostTheme.current);
      else root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', pref);
    }
  }, [pref]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    storage.set('orla.theme', next);
  }, []);

  // O neon é um tema escuro: para o resto do painel (ícones, comandos) conta como "dark".
  const resolved: 'light' | 'dark' =
    pref === 'neon'
      ? 'dark'
      : pref !== 'system'
        ? pref
        : hostTheme.current === 'dark' || hostTheme.current === 'light'
          ? hostTheme.current
          : systemDark
            ? 'dark'
            : 'light';

  return { pref, setPref, resolved };
}

/** Fecha popovers ao clicar fora ou apertar Esc. */
export function useDismiss(open: boolean, refs: RefObject<HTMLElement | null>[], onClose: () => void) {
  const latest = useRef({ refs, onClose });
  latest.current = { refs, onClose };
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (latest.current.refs.some((r) => r.current?.contains(target))) return;
      latest.current.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latest.current.onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
}

export function useKeydown(handler: (e: KeyboardEvent) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => latest.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

/** Trava a rolagem da página enquanto um painel modal está aberto. */
export function useBodyLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [active]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Mantém o foco dentro de um painel modal e o devolve ao fechar. */
export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>, initial?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (!el) return;
    const first = initial?.current ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el;
    first.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      previous?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

/** Copia texto; usa um textarea como alternativa quando a API de área de transferência é recusada. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* tenta a alternativa abaixo */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
