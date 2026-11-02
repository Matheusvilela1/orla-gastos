import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { prefersReducedMotion } from '../lib/motion';
import { cssVars } from './ui';

type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
  ms: number;
  leaving?: boolean;
}

type PushToast = (message: string, kind?: ToastKind, options?: { action?: ToastAction }) => void;

const ToastContext = createContext<PushToast>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    if (prefersReducedMotion()) {
      setItems((list) => list.filter((t) => t.id !== id));
      return;
    }
    // Marca como saindo e remove quando a animação de saída termina.
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 200);
  }, []);

  const push = useCallback<PushToast>((message, kind = 'success', options) => {
    const id = nextId.current++;
    // Avisos com "Desfazer" ficam mais tempo na tela.
    const ms = options?.action ? 7000 : 3800;
    setItems((list) => [...list.slice(-2), { id, message, kind, action: options?.action, ms }]);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" data-kind={t.kind} data-leaving={t.leaving ? '' : undefined} role="status">
            {t.kind === 'error' ? (
              <TriangleAlert size={16} aria-hidden="true" />
            ) : t.kind === 'info' ? (
              <Info size={16} aria-hidden="true" />
            ) : (
              <CircleCheck size={16} aria-hidden="true" />
            )}
            <span className="toast-text">{t.message}</span>
            {t.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action?.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Fechar aviso">
              <X size={14} aria-hidden="true" />
            </button>
            {/* O tempo do aviso é esta barra: ela pausa com o mouse em cima e fecha o aviso ao acabar. */}
            <span className="toast-timer" style={cssVars({ '--t': `${t.ms}ms` })} onAnimationEnd={() => !t.leaving && dismiss(t.id)} aria-hidden="true" />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
