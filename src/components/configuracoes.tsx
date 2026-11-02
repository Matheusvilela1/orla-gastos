import { useRef, useState } from 'react';
import { Code, ImagePlus, Monitor, Moon, MousePointer2, Sparkles, Sun, Trash2, Type, type LucideIcon } from 'lucide-react';
import { BACKGROUNDS, imageFileToDataUrl, useAppearance, type BgId } from '../lib/appearance';
import { useReducedMotion, type ThemePref } from '../lib/hooks';
import { Poster } from './poster';
import { useToast } from './toast';
import { cx } from './ui';

const REPO_URL = 'https://github.com/Matheusvilela1/orla-gastos';

const THEMES: { value: ThemePref; label: string; hint: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Claro', hint: 'Fundo cinza-claro, folhas brancas', icon: Sun },
  { value: 'dark', label: 'Escuro', hint: 'Quase preto, para a noite', icon: Moon },
  { value: 'neon', label: 'Neon', hint: 'Azul-marinho com rosa e vermelho', icon: Sparkles },
  { value: 'system', label: 'Igual ao sistema', hint: 'Claro ou escuro, como o Windows estiver', icon: Monitor },
];

export function SettingsView({ themePref, onThemeChange }: { themePref: ThemePref; onThemeChange: (p: ThemePref) => void }) {
  const look = useAppearance();
  const toast = useToast();
  const reduced = useReducedMotion();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async (f: File) => {
    if (!f.type.startsWith('image/')) {
      toast('Escolha uma imagem (JPG, PNG ou WEBP).', 'error');
      return;
    }
    setLoading(true);
    try {
      const url = await imageFileToDataUrl(f);
      if (look.setImage(url)) toast('Plano de fundo trocado', 'success');
      else toast('A imagem é grande demais para guardar no navegador. Tente uma menor.', 'error');
    } catch {
      toast('Não foi possível abrir essa imagem.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const chooseBg = (id: BgId) => {
    if (id === 'imagem' && !look.image) fileRef.current?.click();
    else look.set({ bg: id });
  };

  return (
    <>
      <Poster kicker="Configurações" lines={[{ text: 'Do seu' }, { text: 'jeito.', accent: true }]} sub="Tema, plano de fundo e efeitos. Fica salvo só neste navegador." />

      <div className="grid data-grid set-grid">
        <section className="sheet sheet-solo" aria-labelledby="set-tema">
          <div className="block">
            <div className="block-head">
              <div>
                <h2 className="card-title" id="set-tema">
                  Tema
                </h2>
                <p className="block-sub">As cores de todo o painel. O Neon é inspirado em portfólios escuros, com rosa e vermelho.</p>
              </div>
            </div>
            <div className="set-themes" role="radiogroup" aria-labelledby="set-tema">
              {THEMES.map((t) => (
                <label key={t.value} className="set-theme" data-theme-preview={t.value}>
                  <input type="radio" name="set-tema" value={t.value} checked={themePref === t.value} onChange={() => onThemeChange(t.value)} />
                  <span className="set-theme-art" aria-hidden="true">
                    <span className="set-theme-side" />
                    <span className="set-theme-sheet">
                      <span className="set-theme-line" />
                      <span className="set-theme-line short" />
                      <span className="set-theme-bar" />
                    </span>
                  </span>
                  <span className="set-theme-text">
                    <strong>
                      <t.icon size={15} aria-hidden="true" />
                      {t.label}
                    </strong>
                    <span>{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="sheet sheet-solo" aria-labelledby="set-fundo">
          <div className="block">
            <div className="block-head">
              <div>
                <h2 className="card-title" id="set-fundo">
                  Plano de fundo
                </h2>
                <p className="block-sub">Aparece atrás das folhas e do menu. Use uma das artes ou uma foto sua.</p>
              </div>
            </div>
            <div className="set-bgs" role="radiogroup" aria-labelledby="set-fundo">
              {BACKGROUNDS.map((b) => (
                <label key={b.id} className="set-bg">
                  <input type="radio" name="set-fundo" value={b.id} checked={look.bg === b.id} onChange={() => chooseBg(b.id)} />
                  <span className="set-bg-art bg-art" data-bg={b.id} aria-hidden="true" />
                  <span className="set-bg-label">{b.label}</span>
                </label>
              ))}
              <label className={cx('set-bg', !look.image && 'is-empty')}>
                <input
                  type="radio"
                  name="set-fundo"
                  value="imagem"
                  checked={look.bg === 'imagem'}
                  onChange={() => chooseBg('imagem')}
                />
                <span className="set-bg-art bg-art" data-bg="imagem" style={look.image ? { backgroundImage: `url("${look.image}")` } : undefined} aria-hidden="true">
                  {!look.image ? <ImagePlus size={22} /> : null}
                </span>
                <span className="set-bg-label">{loading ? 'Abrindo…' : 'Sua imagem'}</span>
              </label>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickImage(f);
                e.target.value = '';
              }}
            />
            {look.image ? (
              <div className="block-actions">
                <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
                  <ImagePlus size={16} aria-hidden="true" />
                  Trocar imagem
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => look.setImage(null)}>
                  <Trash2 size={16} aria-hidden="true" />
                  Remover imagem
                </button>
              </div>
            ) : null}
            <div className="set-sliders" aria-disabled={look.bg === 'padrao' || undefined}>
              <div className="field">
                <label htmlFor="set-dim">
                  Suavizar <span className="opt">{Math.round(look.dim * 100)}%</span>
                </label>
                <input
                  id="set-dim"
                  type="range"
                  className="range"
                  min={0}
                  max={80}
                  step={5}
                  value={Math.round(look.dim * 100)}
                  disabled={look.bg === 'padrao'}
                  onChange={(e) => look.set({ dim: Number(e.target.value) / 100 })}
                />
                <span className="field-hint">Mistura o fundo com a cor do tema, para o texto ficar fácil de ler.</span>
              </div>
              <div className="field">
                <label htmlFor="set-blur">
                  Desfoque <span className="opt">{look.blur} px</span>
                </label>
                <input
                  id="set-blur"
                  type="range"
                  className="range"
                  min={0}
                  max={24}
                  step={2}
                  value={look.blur}
                  disabled={look.bg === 'padrao'}
                  onChange={(e) => look.set({ blur: Number(e.target.value) })}
                />
                <span className="field-hint">Suaviza a imagem para ela não competir com os números.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="sheet sheet-solo" aria-labelledby="set-efeitos">
          <div className="block">
            <div className="block-head">
              <div>
                <h2 className="card-title" id="set-efeitos">
                  Efeitos
                </h2>
                <p className="block-sub">
                  {reduced
                    ? 'Seu sistema pede menos movimento, então o rastro fica desligado e os títulos aparecem sem animação.'
                    : 'Animações extras, para quando você quiser um painel mais vivo.'}
                </p>
              </div>
            </div>
            <div className="switch-row">
              <span className="switch">
                <input id="set-trail" type="checkbox" role="switch" checked={look.trail} onChange={(e) => look.set({ trail: e.target.checked })} />
                <span className="switch-track" aria-hidden="true" />
              </span>
              <label htmlFor="set-trail" className="switch-text">
                <strong>
                  <MousePointer2 size={14} aria-hidden="true" /> Cursor com rastro
                </strong>
                <span>Pequenas cruzes e brilhos seguem o mouse. Não aparece no toque.</span>
              </label>
            </div>
            <div className="switch-row">
              <span className="switch">
                <input id="set-poster" type="checkbox" role="switch" checked={look.poster} onChange={(e) => look.set({ poster: e.target.checked })} />
                <span className="switch-track" aria-hidden="true" />
              </span>
              <label htmlFor="set-poster" className="switch-text">
                <strong>
                  <Type size={14} aria-hidden="true" /> Títulos gigantes
                </strong>
                <span>Títulos tipo cartaz no topo das telas, com as letras subindo ao aparecer.</span>
              </label>
            </div>
          </div>
        </section>

        <section className="sheet sheet-solo" aria-labelledby="set-sobre">
          <div className="block">
            <div className="block-head">
              <div>
                <h2 className="card-title" id="set-sobre">
                  Sobre o Orla
                </h2>
                <p className="block-sub">© 2026 Matheusvilela1. Código aberto sob a licença MIT: pode usar, copiar e modificar, desde que mantenha este aviso.</p>
              </div>
            </div>
            <div className="block-actions">
              <a className="btn btn-secondary" href={REPO_URL} target="_blank" rel="noreferrer">
                <Code size={16} aria-hidden="true" />
                Ver o código no GitHub
              </a>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
