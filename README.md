# Finanzas PWA

Aplicación web progresiva (PWA) offline-first para control financiero personal y gestión patrimonial en Colombia, respaldada por Supabase (PostgreSQL + Realtime) con cálculo automático de saldos mediante triggers de base de datos, políticas estrictas de seguridad por propietario (RLS), restricciones de pesos colombianos enteros (COP) y ciclo de nómina con corte al día 25.

---

## 🌟 Arquitectura y Características

1. **Gestión de Base de Datos, Hardening RLS y Auditoría Contable (Supabase)**:
   - **DDL Declarativo Limpio**: Documentado en `supabase/schema.sql` para nuevas instalaciones desde cero, con restricciones `CHECK` de pesos enteros (`monto = trunc(monto)`), clave foránea `user_id` vinculada a `auth.users(id)` con `DEFAULT auth.uid()`, e índices estratégicos.
   - **Migración Versionada e Idempotente (`20261027_hardening_rls_and_constraints.sql`)**: Diseñada para actualizar bases preexistentes de forma segura:
     - **Verificación de Propietario Explícito**: Requiere obligatoriamente que el DBA defina la variable de sesión `SET LOCAL app.owner_user_id = '<UUID_PROPIETARIO>';` antes de correr, abortando si no se define o si el usuario no existe en `auth.users`.
     - **Pre-validación Contable Estricta (Sin Truncamiento Silencioso)**: No altera importes ni saldos; aborta la migración con un mensaje explícito si detecta importes `<= 0`, valores fraccionarios o saldos inconsistentes en cualquiera de las 5 tablas maestras.
     - **Aislamiento Multi-Usuario**: Endurece las restricciones únicas por usuario (`uq_carteras_user_nombre` y `uq_catalogo_user_macro_sub`).
   - **Triggers y Funciones RPC Transaccionales**:
     - Trigger `recalcular_saldos_carteras` (`SECURITY DEFINER`, `SET search_path = pg_catalog, public`) que recalcula automáticamente `saldo_actual` ante inserciones, ediciones o eliminaciones en `transacciones`.
     - RPC `swap_carteras_orden`: intercambio atómico de posiciones de carteras del usuario autenticado.
     - RPC `process_recurring_expenses_rpc`: ejecución idempotente y atómica de gastos recurrentes programados.
     - RPC `cycle_id_colombia`: determinación canónica del ciclo nómina en horario de Bogotá (`America/Bogota`).
   - **Seguridad RLS y Permisos**: Acceso exclusivo a usuarios `authenticated` mediante políticas `propietario_<tabla>`, revocando todo acceso a `anon` y `public`.

2. **Motor Offline-First con Exclusión Mutua Multipestaña**:
   - Cola de persistencia offline basada en IndexedDB (`finanzas_offline_db`) con mutaciones atómicas (`insert`, `delete`, `update`) y coalescencia de operaciones sobre el mismo registro.
   - **Coordinación entre Pestañas sin Deadlocks**:
     - Separación clara entre operaciones desbloqueadas (`*Unlocked`) y wrappers públicos bajo lock (`withQueueLock`).
     - Exclusión mutua principal mediante la Web Locks API (`navigator.locks`).
     - **Fallback de Exclusión Mutua por Lease**: Cuando el navegador no soporte `navigator.locks`, utiliza un mecanismo de lease lock en `localStorage` (clave `'finanzas_queue_fallback_lock'`, lease de 5000ms con identificador único de pestaña, reintentos con backoff exponencial y jitter, y liberación garantizada en bloque `finally`).
   - **Desacoplamiento Optimista**: Inserción remota (`insertRemote`) separada del cálculo optimista local (`applyOptimisticTransaction`), garantizando cero duplicación de saldos tras sincronizaciones offline.

3. **Autenticación Limpia**:
   - Componente `AuthGate` sin contraseñas precargadas ni datos sensibles en código fuente. Recordación segura del último correo electrónico en `localStorage`.

4. **Ciclo Salarial en Horario Colombia**:
   - Evaluación estricta en zona horaria `America/Bogota` (corte del día 25 al 24 del mes siguiente).
   - Identificador canónico con año `YYYY-MM` (ej. `2026-10`) con soporte para etiquetas legadas.
   - Ajuste automático de fechas para gastos recurrentes en meses cortos (ej. febrero o meses de 30 días con pagos programados el 31).

5. **Simulador de Crédito Mazda 2 (Amortización Francesa)**:
   - Simulación período a período con tasa mensual efectiva real `(1 + EA)^(1/12) - 1`.
   - **Escenario Reducir Plazo**: cálculo exacto de cuotas descontadas y ahorro real de intereses acumulados hasta saldo cero.
   - **Escenario Reducir Cuota**: recálculo de la nueva cuota mensual mediante fórmula de anualidad sobre el saldo restante.
   - Spread de liquidez frente a cuentas remuneradas en Colombia (tasa crédito vs. tasa de rendimiento).

6. **Rendimiento, Code Splitting y PWA**:
   - Carga diferida (`React.lazy` y `Suspense`) del módulo de analíticas y gráficos Recharts.
   - Service Worker (`finanzas-pwa-v17`) con estrategia cache-first para recursos estáticos y purga selectiva de versiones previas.

---

## 🏗️ Tecnologías

- **Frontend**: React 19, TypeScript
- **Empaquetador**: Vite 8
- **Persistencia & Backend**: Supabase (PostgreSQL 15+, Triggers SQL, Realtime WebSockets, RLS)
- **Estilos**: TailwindCSS
- **Iconografía**: Lucide React
- **Gráficos**: Recharts (cargado bajo demanda)
- **Despliegue**: Vercel

---

## 📋 Comandos Disponibles

- `npm run dev`: Inicia el servidor de desarrollo local con recarga rápida (HMR).
- `npx tsc --noEmit`: Validación estricta de tipos TypeScript (0 errores).
- `npm run build`: Compilación de producción (`tsc -b && vite build`).
- `npm run preview`: Previsualización local del bundle generado en `dist/`.
- `npx vercel --prod --yes`: Despliegue directo a producción en Vercel.

---

## 🔐 Ejecución de Migraciones de Base de Datos

Para aplicar la migración de endurecimiento contable en bases de datos existentes, ejecute en el SQL Editor de Supabase:

```sql
BEGIN;
-- Defina el UUID de su usuario propietario en auth.users:
SET LOCAL app.owner_user_id = '00000000-0000-0000-0000-000000000000';

-- Ejecute el contenido de supabase/migrations/20261027_hardening_rls_and_constraints.sql
\ir supabase/migrations/20261027_hardening_rls_and_constraints.sql

COMMIT;
```
