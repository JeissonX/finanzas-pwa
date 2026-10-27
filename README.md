# Finanzas PWA 🚀

Aplicación web progresiva (PWA) offline-first para el control financiero personal y gestión patrimonial estilo Fénix OS, respaldada por Supabase (PostgreSQL + Realtime) con cálculo automático de saldos mediante triggers de base de datos.

---

## 🌟 Características Principales

1. **Arquitectura Reactiva con Supabase**:
   - Suscripción en tiempo real a transacciones (`INSERT`, `UPDATE`, `DELETE`) y carteras.
   - Sincronización bidireccional y actualización optimista instantánea en memoria y almacenamiento local.
   - Trigger PostgreSQL `trg_actualizar_saldos` que recalcula automáticamente los saldos de carteras ante inserciones, modificaciones y eliminaciones.
   - Botón de sincronización limpia y purga forzada en cabecera que vacía la caché de runtime y refresca el estado en caliente.

2. **Registro Rápido Simplificado & Táctil**:
   - Input numérico directo, centrado y estilizado con `autoFocus`, `inputMode="numeric"` y tipografía `text-4xl font-black`.
   - Formateo reactivo en COP en tiempo real (`formatCOP(monto)`) al escribir números.
   - Botón discreto de borrado rápido a la derecha (icono X / "Borrar") para resetear inmediatamente el monto a 0.
   - Eliminación de cuadrícula innecesaria de chips para máxima agilidad en el registro.

3. **Suite Analítica Avanzada (Estilo Fénix OS)**:
   - **Runway · Fondo de Reserva (Oxígeno Financiero)**:
     - Cobertura de costos fijos inflexibles base ($2.264.731 COP/mes: Arriendo, Servicios, Mazda 2, Mercado).
     - Medición del saldo de reserva ('Lulo Bolsillo - Ahorro') en meses de vida con meta a 3.0 meses y semáforo cromático (esmeralda, ámbar, rose).
   - **Matriz de Gastos: Inflexibles vs. Estilo de Vida**:
     - Clasificación inteligente de subcategorías entre indispensables y discrecionales.
     - Barra proporcional bicolor interactiva (Azul Real `#2563EB` vs. Ámbar `#D97706`) con montos en COP y porcentajes del ciclo.
   - **Simulador Mazda 2 · Despiece a Capital & Arbitraje Financiero**:
     - Desglose de cuota regular ($815.731), tasa Efectiva Anual (21.35% E.A.) y costo de intereses bancarios del mes.
     - Selector interactivo de abono a capital (chips rápidos de $500k, $1M, $2M e input libre).
     - Toggle de escenario: **[Reducir Plazo]** (cálculo de cuotas descontadas e intereses ahorrados por año) vs. **[Reducir Cuota]** (nueva cuota mensual y alivio en flujo de caja).
     - Insight de Arbitraje Financiero (Spread de Liquidez): Ahorro del 21.35% E.A. vs. rendimiento del 9.25% E.A. en Lulo (+12.10% E.A. neto / +$121.000/año por cada millón).
   - **Evolución de Patrimonio Neto**:
     - Gráfico de área en Recharts con tema Light Fintech (`#2563EB`) y gradiente sutil.
     - Consolidado en tiempo real de Activos vs. Pasivos con proyección a 6 meses basada en la amortización de deuda.
   - **Ritmo de Gasto Diario Sugerido (Burn Rate)** y **Carga Financiera (DTI)**.

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
