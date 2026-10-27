# Finanzas PWA

Aplicación web progresiva (PWA) offline-first para control financiero personal y gestión patrimonial en Colombia, respaldada por Supabase (PostgreSQL + Realtime) con cálculo automático de saldos mediante triggers de base de datos y ciclo de nómina con corte al día 25.

---

## 🌟 Arquitectura y Características

1. **Gestión de Base de Datos y Sincronización (Supabase)**:
   - Esquema versionado y documentado en `supabase/schema.sql`.
   - Trigger `recalcular_saldos_carteras` que actualiza automáticamente `saldo_actual` en `carteras` ante inserciones, modificaciones o eliminaciones en `transacciones`.
   - Función RPC `swap_carteras_orden` para intercambio atómico de posiciones de carteras.
   - Función RPC `process_recurring_expenses_rpc` para débito automático idempotente de gastos recurrentes en base de datos.
   - Función RPC `cycle_id_colombia` para determinación canónica del ciclo salarial en zona horaria `America/Bogota`.
   - Suscripción Realtime con debounce de 150 ms y contadores de generación para evitar sobreescrituras por peticiones desfasadas.

2. **Motor Offline-First y Contingencia de Datos**:
   - Cola offline basada en mutaciones tipadas (`QueuedMutation`: `insert`, `delete`, `update`).
   - Identificadores únicos basados en `crypto.randomUUID()`.
   - Desacoplamiento entre la actualización optimista local (`applyOptimisticTransaction`) y la inserción remota (`insertRemote`), evitando duplicación de saldos tras reconectar.
   - Protección estricta de caché: ante fallos de conexión o respuestas con error de Supabase, el estado recurre a la última caché válida sin sobreescribir datos en cero.

3. **Ciclo Salarial en Horario Colombia**:
   - Evaluación estricta en zona horaria `America/Bogota` (corte del día 25 al 24 del mes siguiente).
   - Identificador canónico con año `YYYY-MM` (ej. `2026-10`) con soporte para etiquetas legadas.
   - Ajuste automático de fechas para gastos recurrentes en meses cortos (ej. febrero o meses de 30 días con pagos programados el 31).

4. **Simulador de Crédito Mazda 2 (Amortización Francesa)**:
   - Simulación período a período con tasa mensual efectiva real `(1 + EA)^(1/12) - 1`.
   - **Escenario Reducir Plazo**: cálculo exacto de cuotas descontadas y ahorro real de intereses acumulados hasta saldo cero.
   - **Escenario Reducir Cuota**: recálculo de la nueva cuota mensual mediante fórmula de anualidad sobre el saldo restante.
   - Spread de liquidez frente a cuentas remuneradas en Colombia (tasa crédito vs. tasa de rendimiento).

5. **Rendimiento, Code Splitting y PWA**:
   - Carga diferida (`React.lazy` y `Suspense`) del módulo de analíticas y gráficos Recharts, reduciendo el bundle de inicio en ~97.5 kB gzip.
   - Service Worker (`finanzas-pwa-v14`) con estrategia cache-first para recursos estáticos y purga selectiva de cachés con prefijo `finanzas-pwa-`.
   - Limpieza automática de temporizadores (`setTimeout`) mediante referencias de ciclo de vida (`useRef`).

---

## 🏗️ Tecnologías

- **Frontend**: React 19, TypeScript
- **Empaquetador**: Vite 8
- **Persistencia & Backend**: Supabase (PostgreSQL, Triggers SQL, Realtime WebSockets)
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
