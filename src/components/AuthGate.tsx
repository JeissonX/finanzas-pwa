import { useState, useEffect, type ReactNode, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Lock, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../services/supabase';

interface AuthGateProps {
  children: ReactNode;
}

const SAVED_EMAIL_KEY = 'finanzas_saved_login_email';

export default function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(SAVED_EMAIL_KEY) || '';
    }
    return '';
  });
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (mounted) {
        setSession(initialSession);
        setLoading(false);
      }
    }).catch(() => {
      if (mounted) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (mounted) {
        setSession(currentSession);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const cleanEmail = email.trim();
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        setErrorMsg(
          error.message === 'Invalid login credentials'
            ? 'Credenciales incorrectas. Verifica el usuario y la contraseña.'
            : error.message
        );
      } else {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(SAVED_EMAIL_KEY, cleanEmail);
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error de conexión con el servicio de autenticación.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-[#F8FAFC] dark:bg-[#0B0F19] p-4">
        <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
          <Loader2 size={24} className="animate-spin text-slate-900 dark:text-slate-100" />
          <span className="text-xs font-semibold">Verificando sesión…</span>
        </div>
      </div>
    );
  }

  if (session) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-[#F8FAFC] dark:bg-[#0B0F19] px-4 py-8">
      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#131B2E] border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-sm">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center shadow-sm border border-transparent dark:border-slate-700">
            <span className="text-lg">💸</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Finanzas Personales
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Acceso exclusivo de propietario
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-5 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs font-semibold flex items-start gap-2 animate-fade-in">
            <AlertCircle size={16} className="text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              htmlFor="auth-email"
              className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1.5"
            >
              Correo Electrónico
            </label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 transition"
            />
          </div>

          <div>
            <label
              htmlFor="auth-password"
              className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1.5"
            >
              Contraseña / PIN
            </label>
            <div className="relative">
              <input
                id="auth-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 transition"
              />
              <Lock size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 py-3 px-4 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50 active:scale-[0.99]"
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Iniciando sesión…</span>
              </>
            ) : (
              <>
                <span>Ingresar al Sistema</span>
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-[10px] text-slate-400 dark:text-slate-500">
          Autenticación estricta con RLS habilitado en Supabase
        </p>
      </div>
    </div>
  );
}
