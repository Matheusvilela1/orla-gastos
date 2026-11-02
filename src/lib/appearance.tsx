// Aparência: plano de fundo e efeitos. Fica só neste navegador (como o tema),
// porque é preferência de quem está usando, não dado financeiro.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cssVars } from '../components/ui';
import { storage } from './hooks';

export type BgId = 'padrao' | 'aurora' | 'neon' | 'por-do-sol' | 'oceano' | 'grade' | 'imagem';

export const BACKGROUNDS: { id: Exclude<BgId, 'imagem'>; label: string }[] = [
  { id: 'padrao', label: 'Cor do tema' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'neon', label: 'Neon' },
  { id: 'por-do-sol', label: 'Pôr do sol' },
  { id: 'oceano', label: 'Oceano' },
  { id: 'grade', label: 'Grade' },
];

export interface Appearance {
  bg: BgId;
  /** Quanto misturar o plano de fundo com a cor do tema (0 a 0,8). */
  dim: number;
  /** Desfoque do plano de fundo, em px. */
  blur: number;
  /** Rastro de cruzes e brilhos atrás do cursor. */
  trail: boolean;
  /** Títulos grandes no topo de cada tela. */
  poster: boolean;
}

const DEFAULTS: Appearance = { bg: 'padrao', dim: 0.35, blur: 0, trail: true, poster: true };
const KEY = 'orla.aparencia';
const IMAGE_KEY = 'orla.fundo.imagem';

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

function readAppearance(): Appearance {
  const raw = storage.get<Partial<Appearance>>(KEY, {});
  const ids = [...BACKGROUNDS.map((b) => b.id), 'imagem'] as string[];
  return {
    bg: ids.includes(raw.bg as string) ? (raw.bg as BgId) : DEFAULTS.bg,
    dim: clamp(raw.dim, 0, 0.8, DEFAULTS.dim),
    blur: clamp(raw.blur, 0, 24, DEFAULTS.blur),
    trail: typeof raw.trail === 'boolean' ? raw.trail : DEFAULTS.trail,
    poster: typeof raw.poster === 'boolean' ? raw.poster : DEFAULTS.poster,
  };
}

interface AppearanceValue extends Appearance {
  /** Imagem escolhida pela pessoa (data URL), ou null. */
  image: string | null;
  set: (patch: Partial<Appearance>) => void;
  /** Guarda a imagem e passa a usá-la. Devolve false se o navegador não tiver espaço. */
  setImage: (dataUrl: string | null) => boolean;
}

const AppearanceContext = createContext<AppearanceValue | null>(null);

export function useAppearance(): AppearanceValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance precisa estar dentro de <AppearanceProvider>');
  return ctx;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Appearance>(readAppearance);
  const [image, setImageState] = useState<string | null>(() => storage.get<string | null>(IMAGE_KEY, null));

  const set = useCallback((patch: Partial<Appearance>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      storage.set(KEY, next);
      return next;
    });
  }, []);

  const setImage = useCallback(
    (dataUrl: string | null) => {
      try {
        if (dataUrl) window.localStorage.setItem(IMAGE_KEY, JSON.stringify(dataUrl));
        else window.localStorage.removeItem(IMAGE_KEY);
      } catch {
        return false;
      }
      setImageState(dataUrl);
      if (dataUrl) set({ bg: 'imagem' });
      else
        setState((s) => {
          if (s.bg !== 'imagem') return s;
          const next: Appearance = { ...s, bg: 'padrao' };
          storage.set(KEY, next);
          return next;
        });
      return true;
    },
    [set],
  );

  // Sem imagem guardada, "imagem" volta para a cor do tema.
  const bg: BgId = state.bg === 'imagem' && !image ? 'padrao' : state.bg;

  useEffect(() => {
    const root = document.documentElement;
    if (bg === 'padrao') delete root.dataset.bg;
    else root.dataset.bg = bg;
  }, [bg]);

  const value = useMemo<AppearanceValue>(() => ({ ...state, bg, image, set, setImage }), [state, bg, image, set, setImage]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

/** Camada fixa atrás de todo o painel com o plano de fundo escolhido. */
export function Backdrop() {
  const { bg, image, dim, blur } = useAppearance();
  if (bg === 'padrao') return null;
  return (
    <div className="backdrop" aria-hidden="true">
      <div
        className="backdrop-art bg-art"
        data-bg={bg}
        style={cssVars({ '--bg-blur': `${blur}px`, ...(bg === 'imagem' && image ? { backgroundImage: `url("${image}")` } : {}) })}
      />
      <div className="backdrop-dim" style={cssVars({ '--bg-dim': dim })} />
    </div>
  );
}

/** Reduz a foto (no máximo 2000 px no lado maior) e devolve como JPEG, para caber no navegador. */
export async function imageFileToDataUrl(file: File, max = 2000): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}
