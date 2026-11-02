import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppearance } from '../lib/appearance';
import { cssVars } from './ui';

export interface PosterLine {
  text: string;
  /** Linha na cor de destaque. */
  accent?: boolean;
}

/**
 * Título grande, tipo cartaz, no topo de uma tela ou seção. As letras sobem uma a
 * uma quando o título entra na tela. Some quando "Títulos gigantes" está desligado.
 */
export function Poster({ kicker, lines, sub, size = 'lg' }: { kicker: string; lines: PosterLine[]; sub?: ReactNode; size?: 'lg' | 'md' }) {
  const { poster } = useAppearance();
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, poster]);

  if (!poster) return null;

  let i = 0;
  return (
    <header ref={ref} className="poster" data-size={size} data-in={inView ? '' : undefined}>
      <p className="poster-kicker">{kicker}</p>
      <h2 className="poster-title" aria-label={lines.map((l) => l.text).join(' ')}>
        {lines.map((l, li) => (
          <span key={`${li}-${l.text}`} className="poster-line" data-accent={l.accent ? '' : undefined} aria-hidden="true">
            {l.text.split(' ').map((word, wi) => (
              <span key={wi}>
                {wi > 0 ? ' ' : null}
                <span className="poster-word">
                  {[...word].map((ch, ci) => (
                    <span key={ci} className="poster-char" style={cssVars({ '--i': i++ })}>
                      {ch}
                    </span>
                  ))}
                </span>
              </span>
            ))}
          </span>
        ))}
      </h2>
      {sub ? <p className="poster-sub">{sub}</p> : null}
    </header>
  );
}
