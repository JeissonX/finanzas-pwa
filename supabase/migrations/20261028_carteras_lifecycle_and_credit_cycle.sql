-- 20261028_carteras_lifecycle_and_credit_cycle.sql
-- Migración idempotente para soportar archivado de carteras y ciclo de facturación de tarjetas de crédito a 1 cuota

ALTER TABLE public.carteras ADD COLUMN IF NOT EXISTS activa BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.carteras ADD COLUMN IF NOT EXISTS dia_corte INT;
ALTER TABLE public.carteras ADD COLUMN IF NOT EXISTS dia_pago INT;
ALTER TABLE public.carteras ADD COLUMN IF NOT EXISTS limite_credito NUMERIC;

-- Constraints de validación de días de corte y pago (1 a 31)
ALTER TABLE public.carteras DROP CONSTRAINT IF EXISTS chk_carteras_dias_ciclo;
ALTER TABLE public.carteras ADD CONSTRAINT chk_carteras_dias_ciclo CHECK (
    (dia_corte IS NULL OR (dia_corte >= 1 AND dia_corte <= 31)) AND
    (dia_pago IS NULL OR (dia_pago >= 1 AND dia_pago <= 31))
);

-- Constraint de límite de crédito no negativo y pesos enteros
ALTER TABLE public.carteras DROP CONSTRAINT IF EXISTS chk_carteras_limite_credito;
ALTER TABLE public.carteras ADD CONSTRAINT chk_carteras_limite_credito CHECK (
    limite_credito IS NULL OR (limite_credito >= 0 AND limite_credito = trunc(limite_credito))
);

-- Índices de optimización para carteras activas y transacciones de carteras
CREATE INDEX IF NOT EXISTS idx_carteras_user_activa ON public.carteras (user_id, activa);
