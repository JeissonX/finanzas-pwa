-- ==============================================================================
-- MIGRACIÓN: 20261028_idempotency_client_mutation_id.sql
-- Idempotencia para Inserciones desde Cola Offline y Cliente Web
--
-- REGLA DE DESPLIEGUE OBLIGATORIA:
-- Aplicar las migraciones 20261027 y 20261028 en Supabase ANTES de publicar el frontend.
-- Esta migración es completamente re-ejecutable e idempotente (IF NOT EXISTS).
-- ==============================================================================

BEGIN;

-- 1. COLUMNA client_mutation_id EN TABLA TRANSACCIONES (NULLABLE PARA FILAS HISTÓRICAS)
ALTER TABLE public.transacciones
    ADD COLUMN IF NOT EXISTS client_mutation_id uuid;

-- 2. ÍNDICE ÚNICO PARCIAL (EXCLUYE NULOS HISTÓRICOS Y GARANTIZA UNICIDAD STRICTA)
CREATE UNIQUE INDEX IF NOT EXISTS uq_transacciones_client_mutation_id_partial
    ON public.transacciones (client_mutation_id)
    WHERE client_mutation_id IS NOT NULL;

-- 3. ÍNDICE ÚNICO PARA SOPORTE DE ON CONFLICT (client_mutation_id) EN POSTGREST / SUPABASE
CREATE UNIQUE INDEX IF NOT EXISTS uq_transacciones_client_mutation_id
    ON public.transacciones (client_mutation_id);

COMMIT;
