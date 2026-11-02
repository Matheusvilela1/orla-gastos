import { useCallback, useMemo, useState } from 'react';
import { Calculator, Download, Image, Moon, PanelLeft, Percent, PiggyBank, Plus, Sparkles, Sun, Target, TrendingUp, TriangleAlert } from 'lucide-react';
import { isoDate, isSample, monthKeyOf, addMonths, type Expense, type MonthKey } from './lib/finance';
import { AppearanceProvider, Backdrop } from './lib/appearance';
import { FinanceProvider, IS_DEMO, createDemoBackend, useFinance } from './lib/financeStore';
import { storage, useKeydown, useMediaQuery, useTheme, type ThemePref } from './lib/hooks';
import { revealThemeChange } from './lib/motion';
import { SettingsView } from './components/configuracoes';
import { ConquistasView } from './components/conquistas';
import { CursorTrail } from './components/cursorTrail';
import { CATEGORY_ICON, FinanceView, type FinanceIntent } from './components/finance';
import { DataView } from './components/dados';
import { InvestView, type InvestIntent } from './components/investimentos';
import { CommandPalette, Sidebar, Topbar, VIEWS, type Command, type ViewId } from './components/shell';
import { ToastProvider } from './components/toast';

export default function App() {
  return (
    <ToastProvider>
      <AppearanceProvider>
        <FinanceProvider createBackend={IS_DEMO ? createDemoBackend : undefined}>
          <Workspace />
        </FinanceProvider>
      </AppearanceProvider>
    </ToastProvider>
  );
}

const entryIcon = (e: Expense) => CATEGORY_ICON[e.category];

function Workspace() {
  const fin = useFinance();
  const { pref, setPref: applyTheme, resolved } = useTheme();
  const setPref = useCallback((p: ThemePref) => revealThemeChange(() => applyTheme(p)), [applyTheme]);
  const wide = useMediaQuery('(min-width: 1200px)');
  const now = useMemo(() => new Date(), []);
  const today = isoDate(now);

  const [view, setView] = useState<ViewId>(() => {
    const saved = storage.get<ViewId>('orla.view', 'finance');
    return saved in VIEWS ? saved : 'finance';
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => storage.get('orla.sidebar', false));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [month, setMonth] = useState<MonthKey>(() => monthKeyOf(now));
  const [intent, setIntent] = useState<FinanceIntent | null>(null);
  const [investIntent, setInvestIntent] = useState<InvestIntent | null>(null);

  const overdueCount = useMemo(() => fin.expenses.filter((e) => e.kind === 'gasto' && !e.paidAt && e.dueDate < today).length, [fin.expenses, today]);
  const hasSample = useMemo(() => fin.expenses.some(isSample), [fin.expenses]);

  const navigate = useCallback((v: ViewId) => {
    setView(v);
    storage.set('orla.view', v);
    setDrawerOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  const toFinance = useCallback(
    (i: FinanceIntent) => {
      navigate('finance');
      setIntent(i);
    },
    [navigate],
  );

  const toInvest = useCallback(
    (i: InvestIntent) => {
      navigate('investimentos');
      setInvestIntent(i);
    },
    [navigate],
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      storage.set('orla.sidebar', !c);
      return !c;
    });
  }, []);

  // Atalhos: ⌘K / Ctrl+K e "/" abrem a busca, N abre um novo lançamento, ← → trocam o mês.
  useKeydown((e) => {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    const overlay = paletteOpen || !!document.querySelector('.overlay-root');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPaletteOpen((o) => !o);
    } else if (typing || overlay || e.metaKey || e.ctrlKey || e.altKey) {
      if (e.key === 'Escape' && drawerOpen) setDrawerOpen(false);
    } else if (e.key === '/') {
      e.preventDefault();
      setPaletteOpen(true);
    } else if (e.key.toLowerCase() === 'n') {
      e.preventDefault();
      if (view === 'investimentos') toInvest('novo');
      else toFinance({ type: 'new', kind: 'gasto' });
    } else if (view === 'finance' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(target instanceof Element && target.closest('[role="radiogroup"]'))) {
      setMonth((m) => addMonths(m, e.key === 'ArrowLeft' ? -1 : 1));
    }
  });

  const commands: Command[] = useMemo(() => {
    const nav: Command[] = (Object.keys(VIEWS) as ViewId[]).map((id) => ({
      id: `ir-${id}`,
      group: 'Ir para',
      label: VIEWS[id].label,
      icon: VIEWS[id].icon,
      run: () => navigate(id),
    }));
    const entries: Command[] = [
      { id: 'novo-gasto', group: 'Lançar', label: 'Novo gasto', hint: 'N', keywords: 'despesa conta pagar compra', icon: Plus, run: () => toFinance({ type: 'new', kind: 'gasto' }) },
      { id: 'nova-receita', group: 'Lançar', label: 'Nova receita', keywords: 'salario entrada renda ganho', icon: TrendingUp, run: () => toFinance({ type: 'new', kind: 'receita' }) },
      { id: 'novo-invest', group: 'Lançar', label: 'Novo investimento', keywords: 'aplicar aporte investir tesouro cdb poupanca acoes', icon: PiggyBank, run: () => toInvest('novo') },
      ...(overdueCount
        ? [
            {
              id: 'atrasadas',
              group: 'Lançar',
              label: 'Ver contas atrasadas',
              hint: String(overdueCount),
              keywords: 'vencidas atraso',
              icon: TriangleAlert,
              run: () => toFinance({ type: 'overdue' }),
            },
          ]
        : []),
      ...(!fin.expenses.length
        ? [{ id: 'exemplo', group: 'Lançar', label: 'Carregar dados de exemplo', keywords: 'demonstracao teste', icon: Sparkles, run: () => toFinance({ type: 'sample' }) }]
        : []),
    ];
    const actions: Command[] = [
      {
        id: 'tema',
        group: 'Ações',
        label: resolved === 'dark' ? 'Usar tema claro' : 'Usar tema escuro',
        keywords: 'tema escuro claro modo noturno',
        icon: resolved === 'dark' ? Sun : Moon,
        run: () => setPref(resolved === 'dark' ? 'light' : 'dark'),
      },
      ...(pref !== 'neon' ? [{ id: 'neon', group: 'Ações', label: 'Usar tema Neon', keywords: 'tema rosa roxo azul marinho portfolio', icon: Sparkles, run: () => setPref('neon') }] : []),
      { id: 'fundo', group: 'Ações', label: 'Trocar plano de fundo', keywords: 'imagem foto papel de parede aparencia configuracoes', icon: Image, run: () => navigate('configuracoes') },
      { id: 'meta', group: 'Ações', label: 'Ver metas e conquistas', keywords: 'meta objetivo sonho conquista trofeu linha do tempo', icon: Target, run: () => navigate('conquistas') },
      { id: 'simular', group: 'Ações', label: 'Simular investimento', keywords: 'juros compostos rendimento futuro meta', icon: Calculator, run: () => toInvest('simulador') },
      { id: 'porcentagem', group: 'Ações', label: 'Calcular porcentagem', keywords: 'percentual desconto aumento variacao', icon: Percent, run: () => toInvest('porcentagem') },
      { id: 'backup', group: 'Ações', label: 'Baixar backup', keywords: 'exportar copia seguranca', icon: Download, run: () => navigate('dados') },
      ...(wide ? [{ id: 'menu', group: 'Ações', label: collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral', icon: PanelLeft, run: toggleCollapsed }] : []),
    ];
    return [...entries, ...nav, ...actions];
  }, [navigate, toFinance, toInvest, overdueCount, fin.expenses.length, resolved, pref, setPref, wide, collapsed, toggleCollapsed]);

  return (
    <div className="app" data-collapsed={collapsed ? '' : undefined} data-drawer={drawerOpen ? '' : undefined}>
      <Backdrop />
      <CursorTrail />
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <Sidebar
        view={view}
        onNavigate={navigate}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onCloseDrawer={() => setDrawerOpen(false)}
        badges={{ finance: { count: overdueCount, label: `${overdueCount} ${overdueCount === 1 ? 'conta atrasada' : 'contas atrasadas'}`, tone: 'critical' } }}
      />
      <div className="sb-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />

      <div className="main">
        <Topbar
          title={VIEWS[view].label}
          sample={hasSample}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenSearch={() => setPaletteOpen(true)}
          themePref={pref}
          onThemeChange={setPref}
        />

        <main id="conteudo" className="content">
          <div className="content-inner" key={view}>
            {view === 'finance' ? (
              <FinanceView now={now} month={month} onMonth={setMonth} intent={intent} onIntentDone={() => setIntent(null)} />
            ) : view === 'investimentos' ? (
              <InvestView now={now} intent={investIntent} onIntentDone={() => setInvestIntent(null)} />
            ) : view === 'conquistas' ? (
              <ConquistasView now={now} />
            ) : view === 'configuracoes' ? (
              <SettingsView themePref={pref} onThemeChange={setPref} />
            ) : (
              <DataView now={now} />
            )}
            <footer className="page-foot">Seus dados ficam neste computador, em dados/orla-financas.json. Nada vai para a internet.</footer>
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        entries={fin.expenses}
        entryIcon={entryIcon}
        onOpenEntry={(e) => toFinance({ type: 'edit', expense: e })}
      />
    </div>
  );
}
