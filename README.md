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

6. **Gestión de Carteras y Monitor de Ciclo de Facturación (TC 1 Cuota)**:
   - **Ciclo de Vida de Carteras**:
     - Creación y edición accesible (`WalletModal`) con selector de tipo (`BOLSILLO`, `DEBITO`, `EFECTIVO`, `CREDITO`, `PRESTAMO`), saldo inicial con formateo en vivo COP e icono personalizable.
     - **Archivado Lógico Contable**: Si una cartera tiene movimientos históricos (`cuenta_origen`, `cuenta_destino` o `cuenta`), se archiva de forma lógica (`activa = false`) para no descuadrar balances pasados ni reportes. Si no tiene movimientos, se elimina físicamente.
     - **Reactivación**: Sección colapsable *"Carteras Archivadas (X)"* en `WalletsView` con opción inmediata de `Restaurar`.
     - **Selectores de Registro Limpios**: `QuickRegister` y `EditTransactionModal` listan únicamente carteras activas.
   - **Monitor de Ciclo de Facturación para Tarjetas de Crédito (`CreditCardCycleModal`)**:
     - Pastilla interactiva en `WalletsView`: `Corte: día {dia_corte} · Paga: día {dia_pago}`.
     - Evaluación estricta en horario de Colombia (`America/Bogota`):
       - Si el día actual es `<= dia_corte`: corte inició el día `dia_corte + 1` del mes anterior y cierra el `dia_corte` de este mes. Pago: `dia_pago` de este mes.
       - Si el día actual es `> dia_corte`: corte inició el día `dia_corte + 1` de este mes y cierra el `dia_corte` del mes siguiente. Pago: `dia_pago` del mes siguiente.
     - Métricas en vivo: Total a pagar en este corte (suma de compras GASTO), fecha límite con contador de días restantes, cupo disponible con barra de utilización porcentual, historial de compras del corte y edición rápida de los días de corte/pago.

7. **Rendimiento, Code Splitting y PWA**:
   - Carga diferida (`React.lazy` y `Suspense`) del módulo de analíticas y gráficos Recharts.
   - Service Worker (`finanzas-pwa-v25`) con estrategia cache-first para recursos estáticos y purga selectiva de versiones previas.

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

> [!IMPORTANT]
> **REGLA DE DESPLIEGUE OBLIGATORIA**: Aplicar las migraciones `20261027_hardening_rls_and_constraints.sql` y `20261028_idempotency_client_mutation_id.sql` en el SQL Editor de Supabase **ANTES** de publicar el frontend.

### 1. Migración de Endurecimiento RLS (`20261027_hardening_rls_and_constraints.sql`):
Copie el contenido completo de `supabase/migrations/20261027_hardening_rls_and_constraints.sql` en el SQL Editor de Supabase y configure su UUID propietario en la sentencia inicial antes de ejecutar:

```sql
BEGIN;

-- Reemplazar con el UUID real de su usuario propietario en auth.users (Authentication -> Users):
SET LOCAL app.owner_user_id = '00000000-0000-0000-0000-000000000000';

-- ... (cuerpo completo de la migración) ...

COMMIT;
```

### 2. Migración de Idempotencia (`20261028_idempotency_client_mutation_id.sql`):
Copie y ejecute directamente el script `supabase/migrations/20261028_idempotency_client_mutation_id.sql` en el SQL Editor de Supabase. Es completamente idempotente y re-ejecutable (`IF NOT EXISTS`).

### 3. Migración de Ciclo de Facturación y Archivador de Carteras (`20261028_carteras_lifecycle_and_credit_cycle.sql`):
Ejecute el script `supabase/migrations/20261028_carteras_lifecycle_and_credit_cycle.sql` para añadir las columnas `activa`, `dia_corte`, `dia_pago` y `limite_credito` a la tabla `public.carteras`.

---

## ⚠️ Riesgos Aceptados

1. **Uso en varios dispositivos**:
   Un reintento tardío de una actualización ya confirmada puede sobrescribir una edición posterior hecha desde otro dispositivo. Mitigarlo requeriría control de versión en el servidor. Se asume un único dispositivo activo.

2. **Presupuestos y configuración**:
   Presupuestos y configuración se escriben solo online y no pasan por la cola offline.

3. **Regla de despliegue**:
   Aplicar las migraciones `20261027_hardening_rls_and_constraints.sql`, `20261028_idempotency_client_mutation_id.sql` y `20261028_carteras_lifecycle_and_credit_cycle.sql` en Supabase antes de publicar el frontend.
