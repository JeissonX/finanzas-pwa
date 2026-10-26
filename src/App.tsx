import { useState, useCallback, useEffect } from 'react';
import { PenLine, BarChart3, TrendingUp } from 'lucide-react';
import Header from './components/Header';
import QuickRegister from './components/QuickRegister';
import BudgetAccordion from './components/BudgetAccordion';
import AnalyticsView from './components/AnalyticsView';
import WalletsModal from './components/WalletsModal';
import { postTransaccion, enqueue, getOfflineQueue, syncQueue, fetchAppData } from './services/api';
import { haptic } from './utils/format';
import type { TabPrincipal, TipoTransaccion, Transaccion } from './types/finance';

// Toast notification
interface ToastState {
  msg: string;
  type: 'ok' | 'warn' | 'err';
  id: number;
}

const NAV_TABS: { key: TabPrincipal; label: string; Icon: typeof PenLine }[] = [
  { key: 'registro', label: 'Registro', Icon: PenLine },
  { key: 'presupuesto', label: 'Presupuesto', Icon: BarChart3 },
  { key: 'analiticas', label: 'Analíticas', Icon: TrendingUp },
];

export default function App() {
  // ── Theme ──────────────────────────────────────────────────
  const [tema, setTema] = useState<'dark' | 'light'>(() => {
    try {
      const stored = localStorage.getItem('finanzas_tema_v3');
      if (stored === 'dark' || stored === 'light') return stored;
      return 'light';
    } catch { return 'light'; }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (tema === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
    try { localStorage.setItem('finanzas_tema_v3', tema); } catch { /* noop */ }
  }, [tema]);

  const toggleTema = useCallback(() => {
    haptic();
    setTema(t => t === 'dark' ? 'light' : 'dark');
  }, []);

  // ── Network & queue ────────────────────────────────────────
  const [online, setOnline] = useState(navigator.onLine);
  const [sincronizando, setSincronizando] = useState(false);
  const [queueCount, setQueueCount] = useState(() => getOfflineQueue().length);

  useEffect(() => {
    const handleOnline = async () => {
      setOnline(true);
      if (getOfflineQueue().length > 0) {
        setSincronizando(true);
        await syncQueue();
        setQueueCount(getOfflineQueue().length);
        setSincronizando(false);
      }
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Navigation ─────────────────────────────────────────────
  const [tab, setTab] = useState<TabPrincipal>('registro');

  // ── Modals ─────────────────────────────────────────────────
  const [modalCarteras, setModalCarteras] = useState(false);

  // ── Toast ──────────────────────────────────────────────────
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((msg: string, type: ToastState['type'] = 'ok') => {
    const id = Date.now();
    setToast({ msg, type, id });
    setTimeout(() => setToast(prev => prev?.id === id ? null : prev), 3500);
  }, []);

  // ── Save transaction ───────────────────────────────────────
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async (payload: {
    tipo: TipoTransaccion;
    monto: number;
    categoria: string;
    subcategoria: string;
    cuenta: string;
    cuentaDestino?: string;
    comentario?: string;
  }) => {
    setSaving(true);
    const tx: Transaccion = {
      id: Date.now(),
      fecha: new Date().toISOString(),
      sincronizado: false,
      ...payload,
    };

    if (online) {
      try {
        await postTransaccion(tx);
        showToast(`${payload.tipo} guardado — $${payload.monto.toLocaleString('es-CO')}`, 'ok');
        fetchAppData(true).catch(() => {});
      } catch {
        enqueue(tx);
        setQueueCount(getOfflineQueue().length);
        showToast('Guardado offline · se enviará al reconectar', 'warn');
      }
    } else {
      enqueue(tx);
      setQueueCount(getOfflineQueue().length);
      showToast('Sin conexión · guardado localmente', 'warn');
    }

    setSaving(false);
  }, [online, showToast]);

  // ── Initial sync & Service Worker ──────────────────────────
  useEffect(() => {
    fetchAppData().catch(() => {});
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.warn);
    }
  }, []);

  // ── Render ─────────────────────────────────────────────────
  const TOAST_BG: Record<ToastState['type'], string> = {
    ok: 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-900/90 dark:border-emerald-700 dark:text-emerald-100 shadow-md',
    warn: 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-900/90 dark:border-amber-700 dark:text-amber-100 shadow-md',
    err: 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-900/90 dark:border-rose-700 dark:text-rose-100 shadow-md',
  };

  return (
    <>
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-2xl border text-xs font-semibold animate-slide-up transition ${TOAST_BG[toast.type]}`}
          role="status"
          aria-live="polite"
        >
          {toast.msg}
        </div>
      )}

      {/* Wallets modal */}
      <WalletsModal open={modalCarteras} onClose={() => setModalCarteras(false)} />

      {/* App shell */}
      <div className="flex flex-col min-h-screen min-h-[100dvh] bg-[#F8FAFC] dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 overflow-x-hidden">
        <Header
          tema={tema}
          onTemaToggle={toggleTema}
          online={online}
          sincronizando={sincronizando}
          queueCount={queueCount}
          tabActiva={tab}
          onCarteras={() => setModalCarteras(true)}
        />

        {/* Main scrollable area with pb-32 to guarantee full clearance on iPhone 16 Pro Max */}
        <main className="flex-1 overflow-y-auto overscroll-y-contain pb-32 pb-[calc(env(safe-area-inset-bottom)+8rem)]">
          {tab === 'registro' && (
            <QuickRegister onSave={handleSave} saving={saving} />
          )}
          {tab === 'presupuesto' && <BudgetAccordion />}
          {tab === 'analiticas' && <AnalyticsView />}
        </main>

        {/* Bottom navigation bar */}
        <nav
          className="
            fixed bottom-0 inset-x-0 z-40
            bg-white/95 dark:bg-[#131B2E]/95 backdrop-blur-md
            border-t border-slate-200/80 dark:border-slate-800
            shadow-[0_-4px_24px_rgba(0,0,0,0.03)]
            flex items-center justify-around
            px-2
            pb-[env(safe-area-inset-bottom)]
            pt-2
          "
          aria-label="Navegación principal"
        >
          {NAV_TABS.map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { haptic(); setTab(key); }}
                className={`
                  flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl
                  transition-all duration-150 min-w-[76px]
                  ${active
                    ? 'text-slate-900 dark:text-slate-100 font-bold'
                    : 'text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}
                `}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
              >
                <div className={`p-1 rounded-xl transition-colors ${active ? 'bg-slate-100 dark:bg-slate-800' : ''}`}>
                  <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                </div>
                <span className="text-[10px] font-semibold">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}
