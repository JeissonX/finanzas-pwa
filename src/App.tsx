import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { ListOrdered, Wallet, PieChart, TrendingUp } from 'lucide-react';
import Header from './components/Header';
import AuthGate from './components/AuthGate';
import QuickRegisterModal from './components/QuickRegisterModal';
import TransactionsView from './components/TransactionsView';
import WalletsView from './components/WalletsView';
import BudgetAccordion from './components/BudgetAccordion';
import {
  saveTransaction,
  getTransacciones,
  getQueuedMutations,
  syncOfflineQueue,
  fetchAppData,
  updateTransaction,
  deleteTransaction,
} from './services/api';
import { supabase } from './services/supabase';
import { haptic } from './utils/format';
import type { TabNavegacion, TipoTransaccion, Transaccion } from './types/finance';

// Lazy loading del módulo analítico pesado para code splitting (~97.5 kB gzip ahorrados)
const AnalyticsView = lazy(() => import('./components/AnalyticsView'));

export type { TabNavegacion };

// Toast notification
interface ToastState {
  msg: string;
  type: 'ok' | 'warn' | 'err';
  id: string;
}

const NAV_TABS: { key: TabNavegacion; label: string; Icon: typeof ListOrdered }[] = [
  { key: 'movimientos', label: 'Movimientos', Icon: ListOrdered },
  { key: 'carteras', label: 'Carteras', Icon: Wallet },
  { key: 'presupuestos', label: 'Presupuestos', Icon: PieChart },
  { key: 'analiticas', label: 'Analíticas', Icon: TrendingUp },
];

function MainDashboard() {
  // ── Global transactions state ──────────────────────────────
  const [transacciones, setTransacciones] = useState<Transaccion[]>(() => getTransacciones());

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

  // ── Network, session & queue ───────────────────────────────
  const [online, setOnline] = useState(navigator.onLine);
  const [sincronizando, setSincronizando] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  const syncAbortControllerRef = useRef<AbortController | null>(null);

  const triggerSync = useCallback(async (userId: string, isManualOrStartup = false): Promise<number> => {
    if (!userId || !navigator.onLine) return 0;

    // Un AbortController por corrida de sync: abortar cualquier corrida previa
    if (syncAbortControllerRef.current) {
      syncAbortControllerRef.current.abort('Nueva corrida de sincronización iniciada');
    }
    const controller = new AbortController();
    syncAbortControllerRef.current = controller;

    try {
      setSincronizando(true);
      const res = await syncOfflineQueue(controller.signal, { isManualOrStartup });
      const remaining = await getQueuedMutations(userId);
      setQueueCount(remaining.length);
      return res.synced;
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !controller.signal.aborted) {
        console.warn('Error durante sincronización en App:', err);
      }
      return 0;
    } finally {
      if (syncAbortControllerRef.current === controller) {
        syncAbortControllerRef.current = null;
        setSincronizando(false);
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const evaluateUserAndSync = async (userId: string | null) => {
      if (!userId) {
        setQueueCount(0);
        return;
      }
      try {
        const q = await getQueuedMutations(userId);
        if (mounted) setQueueCount(q.length);

        // Disparar sincronización al inicio (startup) solo con sesión resuelta
        if (navigator.onLine && q.length > 0) {
          await triggerSync(userId, true);
        }
      } catch (err) {
        console.warn('Error evaluando cola de usuario:', err);
      }
    };

    // 1. Obtener sesión inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      const uid = session?.user?.id || null;
      setCurrentUserId(uid);
      if (uid) {
        evaluateUserAndSync(uid);
      }
    });

    // 2. Volver a evaluar al cambiar de usuario o evento de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const uid = session?.user?.id || null;
      const prevUid = currentUserIdRef.current;

      if (event === 'SIGNED_OUT' || !uid) {
        // Abortar sync activo al desautenticarse
        syncAbortControllerRef.current?.abort('Usuario desautenticado (SIGNED_OUT)');
        setCurrentUserId(null);
        setQueueCount(0);
        setSincronizando(false);
        return;
      }

      if (prevUid !== uid) {
        // Abortar sync activo ante cambio de identidad
        syncAbortControllerRef.current?.abort('Cambio de usuario en sesión');
        setCurrentUserId(uid);
        evaluateUserAndSync(uid);
      }
    });

    // 3. Manejar reconexión online (solo con sesión resuelta)
    const handleOnline = async () => {
      setOnline(true);
      const uid = currentUserIdRef.current;
      if (!uid) return;
      try {
        const currentQueue = await getQueuedMutations(uid);
        if (currentQueue.length > 0) {
          await triggerSync(uid, false);
        }
      } catch (err) {
        console.warn('Error sincronizando cola al volver a estar online:', err);
      }
    };

    const handleOffline = () => setOnline(false);

    const handleQueueChange = async (e: Event) => {
      const custom = e as CustomEvent<number>;
      const uid = currentUserIdRef.current;
      if (uid) {
        const q = await getQueuedMutations(uid);
        setQueueCount(q.length);
      } else if (typeof custom.detail === 'number') {
        setQueueCount(custom.detail);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('finanzas_queue_updated', handleQueueChange);

    return () => {
      mounted = false;
      // Abortar sync activo en el cleanup del efecto
      syncAbortControllerRef.current?.abort('Efecto desmontado');
      subscription.unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('finanzas_queue_updated', handleQueueChange);
    };
  }, [triggerSync]);

  // ── Navigation (persistencia en F5) ────────────────────────
  const [tab, setTab] = useState<TabNavegacion>(() => {
    try {
      const stored = localStorage.getItem('finanzas_active_tab') as TabNavegacion;
      if (stored && ['movimientos', 'carteras', 'presupuestos', 'analiticas'].includes(stored)) {
        return stored;
      }
      return 'movimientos';
    } catch {
      return 'movimientos';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('finanzas_active_tab', tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  // ── Modal de registro ──────────────────────────────────────
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);

  // ── Toast con Cleanup Seguro de Timer ──────────────────────
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, type: ToastState['type'] = 'ok') => {
    const id = crypto.randomUUID();
    setToast({ msg, type, id });
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    const duration = type === 'err' ? 6500 : 3500;
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => (prev?.id === id ? null : prev));
    }, duration);
  }, []);

  useEffect(() => {
    const handleSyncError = (e: Event) => {
      const custom = e as CustomEvent<string>;
      if (custom.detail) {
        showToast(custom.detail, 'err');
      }
    };
    window.addEventListener('supabase-sync-error', handleSyncError);
    return () => {
      window.removeEventListener('supabase-sync-error', handleSyncError);
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, [showToast]);

  // ── Refresh app data con Contador de Generación ────────────
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshGenRef = useRef(0);

  const refreshData = useCallback(async (force = false) => {
    const gen = ++refreshGenRef.current;
    try {
      const data = await fetchAppData(force);
      if (gen === refreshGenRef.current && data?.transacciones) {
        setTransacciones(data.transacciones);
      }
    } catch (err) {
      console.error('Error sincronizando datos:', err);
    }
  }, []);

  const handleForceRefresh = useCallback(async () => {
    setIsRefreshing(true);
    haptic(30);
    try {
      try {
        localStorage.removeItem('finanzas_appdata_cache_v3');
        localStorage.removeItem('finanzas_cached_appdata_v4');
      } catch {
        /* noop */
      }

      // Filtrar llaves selectivamente con key.startsWith('finanzas-pwa-')
      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          const cacheKeys = await window.caches.keys();
          await Promise.all(
            cacheKeys
              .filter(k => k.startsWith('finanzas-pwa-'))
              .map(k => window.caches.delete(k))
          );
        } catch (cErr) {
          console.warn('Error purgando caches:', cErr);
        }
      }

      const uid = currentUserIdRef.current;
      if (uid) {
        const q = await getQueuedMutations(uid);
        if (q.length > 0) {
          await triggerSync(uid, true);
        }
      }

      await refreshData(true);
      showToast('Datos sincronizados y caché purgada', 'ok');
    } catch (err) {
      console.error('Error durante la sincronización limpia:', err);
      showToast('Error al sincronizar datos', 'err');
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshData, showToast, triggerSync]);

  // ── Update transaction (Optimistic + Realtime) ─────────────
  const handleUpdateTransaction = useCallback(async (id: number | string, updated: Partial<Transaccion>): Promise<void> => {
    haptic(40);
    setTransacciones(prev => prev.map(t => {
      if (String(t.id) === String(id)) {
        const cuentaFinal = updated.cuenta || t.cuenta;
        return {
          ...t,
          ...updated,
          monto: updated.monto !== undefined ? Number(updated.monto) : t.monto,
          categoria: updated.macroCategoria || updated.categoria || t.categoria,
          macroCategoria: updated.macroCategoria || updated.categoria || t.macroCategoria,
          subcategoria: updated.subcategoria || t.subcategoria,
          cuenta: cuentaFinal,
          cuentaOrigen: updated.tipo === 'GASTO' ? cuentaFinal : (updated.cuentaOrigen ?? t.cuentaOrigen),
          cuentaDestino: updated.tipo === 'INGRESO' ? cuentaFinal : (updated.cuentaDestino ?? t.cuentaDestino),
          comentario: updated.comentario !== undefined ? updated.comentario : t.comentario,
          detalle: updated.detalle !== undefined ? updated.detalle : t.detalle,
        };
      }
      return t;
    }));

    try {
      const ok = await updateTransaction(id, updated);
      if (ok) {
        showToast('Movimiento actualizado', 'ok');
      } else {
        showToast('Error al actualizar movimiento', 'err');
      }
      await fetchAppData(true);
    } catch (err) {
      console.error('Error al actualizar transacción:', err);
      showToast('Error al actualizar movimiento', 'err');
      await fetchAppData(true);
    }
  }, [showToast]);

  // ── Delete transaction (CORRECCIÓN E: Feedback honesto síncrono vs encolado) ──
  const handleDeleteTransaction = useCallback(async (id: number | string): Promise<boolean> => {
    haptic(50);
    setTransacciones(prev => prev.filter(t => String(t.id) !== String(id)));
    try {
      const deletedRemotely = await deleteTransaction(id);
      if (deletedRemotely) {
        showToast('Movimiento eliminado y revertido', 'ok');
        await fetchAppData(true);
      } else {
        showToast('Eliminación encolada (pendiente de sincronizar)', 'warn');
      }
      return deletedRemotely;
    } catch (err) {
      console.error('Error al eliminar transacción:', err);
      showToast('Error al eliminar movimiento', 'err');
      await fetchAppData(true);
      return false;
    }
  }, [showToast]);

  // ── Save transaction (UUID + Contingencia) ──────────────────
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async (payload: {
    tipo: TipoTransaccion;
    monto: number;
    categoria: string;
    subcategoria: string;
    cuenta: string;
    cuentaDestino?: string;
    cuentaOrigen?: string;
    macroCategoria?: string;
    macro?: string;
    sub?: string;
    comentario?: string;
    detalle?: string;
  }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.user?.id) {
      showToast('42501: Sesión requerida para registrar movimientos', 'err');
      return;
    }

    setSaving(true);
    const tx: Transaccion = {
      id: crypto.randomUUID(),
      user_id: session.user.id,
      fecha: new Date().toISOString(),
      sincronizado: false,
      ...payload,
    };

    setTransacciones(prev => [tx, ...prev.filter(t => String(t.id) !== String(tx.id))]);

    try {
      await saveTransaction(tx);
      showToast(`${payload.tipo} guardado — $${payload.monto.toLocaleString('es-CO')}`, 'ok');
      refreshData(true);
    } catch (err: any) {
      const q = await getQueuedMutations(currentUserIdRef.current || undefined);
      setQueueCount(q.length);
      const errMsg = err?.message || 'Guardado offline · se enviará al reconectar';
      showToast(errMsg, 'warn');
    } finally {
      const q = await getQueuedMutations(currentUserIdRef.current || undefined);
      setQueueCount(q.length);
      setSaving(false);
    }
  }, [refreshData, showToast]);

  // ── Initial sync, Realtime con Debounce de 150ms y Service Worker
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerDebouncedRefresh = useCallback(() => {
    if (realtimeDebounceRef.current) {
      clearTimeout(realtimeDebounceRef.current);
    }
    realtimeDebounceRef.current = setTimeout(() => {
      fetchAppData(true);
    }, 150);
  }, []);

  useEffect(() => {
    refreshData(false);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.warn);
    }

    const channel = supabase.channel('finanzas-live')
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'transacciones' }, (payload) => {
        const deletedId = (payload.old as { id?: number | string })?.id;
        if (deletedId !== undefined && deletedId !== null) {
          setTransacciones(prev => prev.filter(t => String(t.id) !== String(deletedId)));
        }
        triggerDebouncedRefresh();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transacciones' }, (payload) => {
        if (payload.new) {
          const row = payload.new as any;
          const mapped: Transaccion = {
            id: row.id ?? crypto.randomUUID(),
            fecha: row.fecha || new Date().toISOString(),
            tipo: row.tipo,
            monto: Number(row.monto) || 0,
            categoria: row.macro_categoria || '',
            macroCategoria: row.macro_categoria || '',
            macro: row.macro_categoria || '',
            subcategoria: row.subcategoria || '',
            sub: row.subcategoria || '',
            cuenta: row.cuenta || row.cuenta_origen || '',
            cuentaOrigen: row.cuenta_origen || undefined,
            cuentaDestino: row.cuenta_destino || undefined,
            detalle: row.detalle || '',
            comentario: row.detalle || '',
            sincronizado: true,
          };
          setTransacciones(prev => {
            if (prev.some(t => String(t.id) === String(mapped.id))) return prev;
            return [mapped, ...prev];
          });
        }
        triggerDebouncedRefresh();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transacciones' }, (payload) => {
        if (payload.new) {
          const row = payload.new as any;
          setTransacciones(prev => prev.map(t => {
            if (String(t.id) === String(row.id)) {
              return {
                ...t,
                tipo: row.tipo ?? t.tipo,
                monto: row.monto != null ? Number(row.monto) : t.monto,
                categoria: row.macro_categoria ?? t.categoria,
                macroCategoria: row.macro_categoria ?? t.macroCategoria,
                subcategoria: row.subcategoria ?? t.subcategoria,
                cuenta: row.cuenta ?? t.cuenta,
                cuentaOrigen: row.cuenta_origen ?? t.cuentaOrigen,
                cuentaDestino: row.cuenta_destino ?? t.cuentaDestino,
                detalle: row.detalle ?? t.detalle,
                comentario: row.detalle ?? t.comentario,
                fecha: row.fecha ?? t.fecha,
              };
            }
            return t;
          }));
        }
        triggerDebouncedRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'carteras' }, () => {
        triggerDebouncedRefresh();
      })
      .subscribe();

    const handleTxUpdated = (e: Event) => {
      const custom = e as CustomEvent<Transaccion[]>;
      if (custom.detail) {
        setTransacciones(custom.detail);
      }
    };
    window.addEventListener('finanzas_transacciones_updated', handleTxUpdated);

    return () => {
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current);
      }
      supabase.removeChannel(channel);
      window.removeEventListener('finanzas_transacciones_updated', handleTxUpdated);
    };
  }, [refreshData, triggerDebouncedRefresh]);

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
          className={`fixed top-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-2xl border text-xs font-semibold animate-slide-up transition max-w-[92vw] text-center break-words ${TOAST_BG[toast.type]}`}
          role="status"
          aria-live="polite"
        >
          {toast.msg}
        </div>
      )}

      {/* Modal de Registro Rápido */}
      <QuickRegisterModal
        open={isRegisterOpen}
        onClose={() => setIsRegisterOpen(false)}
        onSave={handleSave}
        saving={saving}
      />

      {/* App shell con scroll vertical natural en PC y móvil */}
      <div className="flex flex-col min-h-screen min-h-[100dvh] bg-[#F8FAFC] dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100">
        <Header
          tema={tema}
          onTemaToggle={toggleTema}
          online={online}
          sincronizando={sincronizando}
          queueCount={queueCount}
          tabActiva={tab}
          onForceRefresh={handleForceRefresh}
          isRefreshing={isRefreshing}
        />

        {/* Main scrollable area con scroll natural en PC y seguro en móvil */}
        <main className="flex-1 w-full md:overflow-visible overflow-y-auto overscroll-y-contain pb-32 pb-[calc(env(safe-area-inset-bottom)+8rem)]">
          {tab === 'movimientos' && (
            <TransactionsView
              transacciones={transacciones}
              onDeleteTransaction={handleDeleteTransaction}
              onUpdateTransaction={handleUpdateTransaction}
              onOpenRegister={() => setIsRegisterOpen(true)}
              onNavigateToRegister={() => setIsRegisterOpen(true)}
            />
          )}
          {tab === 'carteras' && <WalletsView />}
          {tab === 'presupuestos' && <BudgetAccordion />}
          {tab === 'analiticas' && (
            <Suspense
              fallback={
                <div className="flex flex-col gap-4 p-4 max-w-lg mx-auto animate-pulse">
                  <div className="h-28 rounded-2xl bg-slate-200/70 dark:bg-slate-800/60" />
                  <div className="h-44 rounded-2xl bg-slate-200/70 dark:bg-slate-800/60" />
                  <div className="h-60 rounded-2xl bg-slate-200/70 dark:bg-slate-800/60" />
                </div>
              }
            >
              <AnalyticsView />
            </Suspense>
          )}
        </main>

        {/* Bottom navigation bar: 4 pestañas */}
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
                  flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl
                  transition-all duration-150 min-w-[70px] cursor-pointer
                  ${active
                    ? 'text-slate-900 dark:text-slate-100 font-bold'
                    : 'text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}
                `}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
              >
                <div className={`p-1 rounded-xl transition-colors ${active ? 'bg-slate-100 dark:bg-slate-800' : ''}`}>
                  <Icon size={19} strokeWidth={active ? 2.5 : 1.8} />
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

export default function App() {
  return (
    <AuthGate>
      <MainDashboard />
    </AuthGate>
  );
}
