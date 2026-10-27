# Finanzas PWA 🚀

Aplicación web progresiva (PWA) offline-first para el control financiero personal, sincronizada bidireccionalmente con Google Sheets mediante Google Apps Script.

---

## 🌟 Características Principales

1. **Sincronización Bidireccional con Google Sheets (GAS v8.1)**:
   - Registro optimista instantáneo en memoria y `localStorage`.
   - Normalización de payload tolerante y redundante enviando claves descriptivas y abreviadas (`macro`, `categoria`, `sub`, `subcategoria`, `cuentaOrigen`, `cuentaDestino`, `cuenta`, `detalle`, `comentario`).
   - Sincronización en segundo plano de saldos oficiales, presupuestos dinámicos y transacciones históricas.

2. **Offline-First & Cola de Contingencia**:
   - Registro y edición de transacciones sin conexión.
   - Cola offline en `localStorage` con reintento automático y descarte de duplicados al reconectar.
   - PWA Service Worker (`finanzas-pwa-v4`) con estrategia cache-first para assets estáticos y bypass explícito para Google Apps Script.

3. **Presupuestos 100% Dinámicos**:
   - Renderizado dinámico de subcategorías y montos asignados directamente desde la hoja de cálculo.
   - Mensajes limpios de estado cuando no hay subcategorías asignadas en el ciclo activo.

4. **Experiencia Multiplataforma**:
   - Diseño responsivo adaptado para PC, tabletas y teléfonos (iPhone 16 Pro Max y dispositivos Android).
   - Scroll vertical natural sin atrapamiento en desktop y pestañas persistentes tras recarga (F5).
   - Temas Claro (Fintech sobrio) y Oscuro con contraste estricto WCAG AA.

---

## 🏗️ Arquitectura y Tecnologías

- **Framework**: React 19 + TypeScript
- **Bundler**: Vite 8
- **Estilos**: TailwindCSS (diseño sobrio, cero bloatware visual)
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

---

## 🔒 Estructura Unificada del Payload

Cada transacción procesada por `saveTransaction()`, `postAjuste()` o la cola offline implementa el siguiente esquema:

```typescript
const payload = {
  id: tx.id,
  fecha: tx.fecha,
  tipo: tx.tipo,
  monto: tx.monto,
  macro: tx.macroCategoria || tx.categoria,
  categoria: tx.macroCategoria || tx.categoria,
  sub: tx.subcategoria,
  subcategoria: tx.subcategoria,
  cuentaOrigen: tx.tipo === 'GASTO' ? tx.cuenta : (tx.tipo === 'TRANSFERENCIA' ? tx.cuentaOrigen : ''),
  cuentaDestino: tx.tipo === 'INGRESO' ? tx.cuenta : (tx.tipo === 'TRANSFERENCIA' ? tx.cuentaDestino : ''),
  cuenta: tx.cuenta || '',
  detalle: tx.comentario || '',
  comentario: tx.comentario || ''
};
```
