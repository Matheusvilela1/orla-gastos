import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, HardDrive, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, PiggyBank, Search, Settings, Sparkles, Sun, Trophy, Wallet, X, type LucideIcon } from 'lucide-react';
import { CATEGORIES, monthLabel, type Expense } from '../lib/finance';
import { fmt, fmtDate, normalize } from '../lib/format';
import { isMac, useBodyLock, useFocusTrap, useScrolled, type ThemePref } from '../lib/hooks';
import { usePresence } from '../lib/motion';
import { Kbd, Logo, Popover, cx } from './ui';

export type ViewId = 'finance' | 'investimentos' | 'conquistas' | 'dados' | 'configuracoes';

export const VIEWS: Record<ViewId, { label: string; icon: LucideIcon }> = {
  finance: { label: 'Meu mês', icon: Wallet },
  investimentos: { label: 'Investimentos', icon: PiggyBank },
  conquistas: { label: 'Conquistas', icon: Trophy },
  dados: { label: 'Dados e backup', icon: HardDrive },
  configuracoes: { label: 'Configurações', icon: Settings },
};

const MAIN_NAV: ViewId[] = ['finance', 'investimentos', 'conquistas', 'dados', 'configuracoes'];

// ---------------------------------------------------------------------------
// Menu lateral

export interface SidebarBadge {
  count: number;
  label: string;
  tone?: 'critical';
}

export function Sidebar({
  view,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  onCloseDrawer,
  badges,
  footer,
}: {
  view: ViewId;
  onNavigate: (v: ViewId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCloseDrawer: () => void;
  badges: Partial<Record<ViewId, SidebarBadge>>;
  footer?: ReactNode;
}) {
  const item = (id: ViewId) => {
    const { label, icon: Icon } = VIEWS[id];
    const badge = badges[id];
    return (
      <li key={id}>
        <button type="button" className="sb-item" aria-current={view === id ? 'page' : undefined} data-label={label} onClick={() => onNavigate(id)}>
          <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
          <span className="sb-label">{label}</span>
          {badge && badge.count > 0 ? (
            <span className="sb-badge" data-tone={badge.tone} aria-label={badge.label} title={badge.label}>
              {badge.count}
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <aside className="sidebar" aria-label="Menu principal">
      <div className="sb-brand">
        <Logo />
        <span className="sb-brand-text">
          <span className="sb-brand-name">Orla</span>
          <span className="sb-brand-sub">Finanças pessoais</span>
        </span>
        <button type="button" className="icon-btn sb-close" onClick={onCloseDrawer} aria-label="Fechar menu">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <nav className="sb-nav" aria-label="Seções">
        <ul>{MAIN_NAV.map(item)}</ul>
      </nav>
      <div className="sb-bottom">
        {footer}
        <button
          type="button"
          className="sb-item sb-collapse"
          onClick={onToggleCollapsed}
          data-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <PanelLeftOpen size={19} strokeWidth={1.9} aria-hidden="true" /> : <PanelLeftClose size={19} strokeWidth={1.9} aria-hidden="true" />}
          <span className="sb-label">{collapsed ? 'Expandir menu' : 'Recolher menu'}</span>
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Barra superior

const THEME_OPTIONS: { value: ThemePref; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'neon', label: 'Neon', icon: Sparkles },
  { value: 'system', label: 'Igual ao sistema', icon: Monitor },
];

function ThemeMenu({ pref, onChange }: { pref: ThemePref; onChange: (p: ThemePref) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const current = THEME_OPTIONS.find((o) => o.value === pref) ?? THEME_OPTIONS[3];
  const Icon = current.icon;
  return (
    <div className="pop-anchor">
      <button
        ref={btnRef}
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Tema: ${current.label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={18} aria-hidden="true" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} label="Tema" className="menu">
        <div role="menu" aria-label="Tema">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={pref === o.value}
              className="menu-item"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <o.icon size={16} aria-hidden="true" />
              <span>{o.label}</span>
              {pref === o.value ? <Check size={16} strokeWidth={2.6} className="menu-check" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

export function Topbar({
  title,
  sample,
  onOpenDrawer,
  onOpenSearch,
  themePref,
  onThemeChange,
}: {
  title: string;
  sample: boolean;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
  themePref: ThemePref;
  onThemeChange: (p: ThemePref) => void;
}) {
  const scrolled = useScrolled();
  return (
    <header className="topbar" data-scrolled={scrolled ? '' : undefined}>
      <div className="topbar-inner">
        <button type="button" className="icon-btn tb-menu" onClick={onOpenDrawer} aria-label="Abrir menu">
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className="tb-title">
          <h1>{title}</h1>
          {sample ? <span className="sample-pill">Dados de exemplo</span> : null}
        </div>
        <div className="tb-actions">
          <button type="button" className="search-trigger" onClick={onOpenSearch} aria-label="Buscar lançamentos ou ações">
            <Search size={16} aria-hidden="true" />
            <span className="st-label">Buscar lançamentos…</span>
            <span className="st-kbd">
              <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <ThemeMenu pref={themePref} onChange={onThemeChange} />
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Busca e comandos (⌘K)

export interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  entries,
  entryIcon,
  onOpenEntry,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  entries: Expense[];
  entryIcon: (e: Expense) => LucideIcon;
  onOpenEntry: (e: Expense) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [present, leaving] = usePresence(open, 180);
  useBodyLock(open);
  useFocusTrap(open, panelRef, inputRef);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const results = useMemo<Command[]>(() => {
    const q = normalize(query.trim());
    const base = commands.filter((c) => !q || normalize(`${c.label} ${c.keywords ?? ''}`).includes(q));
    if (q.length < 2) return base;
    const hits: Command[] = [...entries]
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
      .filter((e) => normalize(`${e.description} ${e.supplier} ${e.notes} ${CATEGORIES[e.category].label} ${fmt.dec(e.amount, 2)}`).includes(q))
      .slice(0, 8)
      .map((e) => ({
        id: `lanc-${e.id}`,
        group: 'Lançamentos',
        label: `${e.description}, ${fmtDate.dayMonthYear(new Date(`${e.dueDate}T12:00`))}`,
        hint: `${e.kind === 'gasto' ? '' : '+'}${fmt.brl2(e.amount)}`,
        keywords: monthLabel(e.competence),
        icon: entryIcon(e),
        run: () => onOpenEntry(e),
      }));
    return [...base, ...hits];
  }, [query, commands, entries, entryIcon, onOpenEntry]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(`cmd-${results[active]?.id}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open, results]);

  if (!present) return null;

  const run = (c: Command) => {
    onClose();
    c.run();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = results[active];
      if (c) run(c);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const groups: { name: string; items: { c: Command; i: number }[] }[] = [];
  results.forEach((c, i) => {
    const g = groups.find((x) => x.name === c.group);
    if (g) g.items.push({ c, i });
    else groups.push({ name: c.group, items: [{ c, i }] });
  });

  return (
    <div className="overlay-root" data-leaving={leaving ? '' : undefined}>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="cmdk" role="dialog" aria-modal="true" aria-label="Buscar e executar ações">
        <div className="cmdk-input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            id="cmdk-busca"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-lista"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
            aria-autocomplete="list"
            placeholder="Busque um lançamento ou uma ação"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="cmdk-esc" onClick={onClose} aria-label="Fechar busca">
            <Kbd>Esc</Kbd>
          </button>
        </div>
        <div className="cmdk-list" id="cmdk-lista" role="listbox" aria-label="Resultados">
          {results.length === 0 ? (
            <p className="cmdk-empty">Nada encontrado para “{query}”. Tente a descrição, o local ou o valor.</p>
          ) : (
            groups.map((g) => (
              <div key={g.name} role="group" aria-label={g.name} className="cmdk-group">
                <div className="cmdk-group-label" aria-hidden="true">
                  {g.name}
                </div>
                {g.items.map(({ c, i }) => (
                  <div
                    key={c.id}
                    id={`cmd-${c.id}`}
                    role="option"
                    aria-selected={i === active}
                    className={cx('cmdk-item', i === active && 'is-active')}
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(c)}
                  >
                    <c.icon size={17} aria-hidden="true" />
                    <span className="cmdk-label">{c.label}</span>
                    {c.hint ? <span className="cmdk-hint">{c.hint}</span> : null}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="cmdk-foot" aria-hidden="true">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navegar
          </span>
          <span>
            <Kbd>Enter</Kbd> abrir
          </span>
          <span>
            <Kbd>Esc</Kbd> fechar
          </span>
        </div>
      </div>
    </div>
  );
}
