# Finanzas PWA 🚀

Aplicación web progresiva (PWA) offline-first para el control financiero personal y gestión patrimonial, respaldada por Supabase (PostgreSQL + Realtime) con cálculo automático de saldos mediante triggers de base de datos.

---

## 🌟 Características Principales

1. **Arquitectura Reactiva con Supabase**:
   - Suscripción en tiempo real a transacciones (`INSERT`, `UPDATE`, `DELETE`) y carteras.
   - Sincronización bidireccional y actualización optimista instantánea en memoria y almacenamiento local.
   - Trigger PostgreSQL `trg_actualizar_saldos` que recalcula automáticamente los saldos de carteras ante inserciones, modificaciones y eliminaciones.
   - Botón de sincronización limpia y purga forzada en cabecera que vacía la caché de runtime y refresca el estado en caliente.

2. **Registro Rápido Simplificado & Edición de Movimientos**:
   - Input numérico directo, centrado y estilizado con autoFocus y tipografía grande (`text-3xl` / `text-4xl`).
   - Formateo en COP en tiempo real (`$ #,##0`) con botón discreto de borrado rápido.
   - Modal slide-up de edición de transacciones para modificar montos, macro-categorías, subcategorías, medios de pago y comentarios sin perder integridad contable.

3. **Analíticas Avanzadas de Crédito y Flujo**:
   - **Ritmo de Gasto Diario Sugerido (Burn Rate)**: Calcula los días restantes exactos hasta el día 24 del ciclo salarial y proyecta el tope de gasto diario sobre el balance disponible.
   - **Carga Financiera (DTI)**: Ratio deuda/ingreso que consolida la cuota del crédito de consumo y el gasto mensual en tarjetas de crédito, clasificado con semáforo inteligente (*Saludable*, *Alerta*, *Elevado*).
   - **Crédito Mazda 2 · Simulador y Despiece a Capital**: Desglose de cuota regular ($815.731), costo real de intereses bancarios y simulador interactivo de abono extraordinario a capital con cálculo de interés ahorrado por año y cuotas descontadas de deuda.
   - Historial comparativo de gastos vs. ingresos y desglose porcentual por categorías.

4. **Offline-First & PWA**:
   - Registro y edición de transacciones sin conexión a internet.
   - Cola de contingencia local que reintenta sincronizaciones al recuperar conectividad.
   - Service Worker (`finanzas-pwa-v13`) con estrategia cache-first para recursos estáticos y bypass selectivo para APIs de datos.
   - Diseño Light/Dark Fintech con contraste estricto WCAG AA y soporte completo para dispositivos móviles y escritorio.

---

## 🏗️ Tecnologías

- **Framework**: React 19 + TypeScript
- **Bundler**: Vite 8
- **Base de Datos & Backend**: Supabase (PostgreSQL, Triggers SQL, Realtime WebSockets)
- **Estilos**: TailwindCSS
- **Iconografía**: Lucide React
- **Gráficos**: Recharts
- **Despliegue**: Vercel Production

---

## 📋 Scripts Disponibles

- `npm run dev`: Inicia el servidor de desarrollo local con recarga en caliente (HMR).
- `npx tsc --noEmit`: Validación estricta de tipos TypeScript.
- `npm run build`: Compilación de producción (`tsc -b && vite build`).
- `npm run preview`: Previsualización local del bundle generado en `dist/`.
- `npx vercel --prod --yes`: Despliegue directo a producción en Vercel.
