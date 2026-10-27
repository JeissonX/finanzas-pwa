-- ==============================================================================
-- MIGRACIÓN: 20261027_hardening_rls_and_constraints.sql
-- Hardening RLS por Propietario Autenticado y Pesos Enteros COP para Bases Existentes
--
-- INSTRUCCIONES DE EJECUCIÓN (DBA / Supabase SQL Editor):
-- Esta migración requiere que el DBA declare explícitamente el UUID del propietario
-- registrado en auth.users antes de ejecutar, garantizando auditoría contable estricta:
--
--   BEGIN;
--   SET LOCAL app.owner_user_id = '<UUID_DEL_PROPIETARIO_EN_AUTH_USERS>';
--   \ir 20261027_hardening_rls_and_constraints.sql
--   COMMIT;
-- ==============================================================================

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. TABLAS BASE PREEXISTENTES (CREATE TABLE IF NOT EXISTS)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.carteras (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('debito', 'credito', 'inversion', 'efectivo', 'deuda', 'remunerado')),
    saldo_inicial NUMERIC NOT NULL DEFAULT 0,
    saldo_actual NUMERIC NOT NULL DEFAULT 0,
    icono TEXT DEFAULT '💳',
    orden INT NOT NULL DEFAULT 99,
    permite_gasto BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transacciones (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tipo TEXT NOT NULL CHECK (tipo IN ('GASTO', 'INGRESO', 'TRANSFERENCIA', 'AJUSTE')),
    monto NUMERIC NOT NULL,
    macro_categoria TEXT NOT NULL DEFAULT '',
    subcategoria TEXT NOT NULL DEFAULT '',
    cuenta TEXT NOT NULL DEFAULT '',
    cuenta_origen TEXT,
    cuenta_destino TEXT,
    detalle TEXT DEFAULT '',
    ciclo TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.catalogo_categorias (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    macro_categoria TEXT NOT NULL,
    subcategoria TEXT NOT NULL,
    presupuesto_base NUMERIC NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT true,
    cuenta_defecto TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.gastos_recurrentes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    nombre TEXT NOT NULL,
    monto NUMERIC NOT NULL,
    macro_categoria TEXT NOT NULL,
    subcategoria TEXT NOT NULL,
    cuenta TEXT NOT NULL,
    dia_pago INT NOT NULL CHECK (dia_pago BETWEEN 1 AND 31),
    activo BOOLEAN NOT NULL DEFAULT true,
    ultimo_ciclo_ejecutado TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.historico_patrimonio (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_activos NUMERIC NOT NULL DEFAULT 0,
    total_pasivos NUMERIC NOT NULL DEFAULT 0,
    patrimonio_neto NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 3. AÑADIR COLUMNA user_id A TABLAS PREEXISTENTES (SI NO EXISTE)
-- ==============================================================================

ALTER TABLE public.carteras ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.transacciones ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.catalogo_categorias ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.gastos_recurrentes ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.historico_patrimonio ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- ==============================================================================
-- 4. VALIDACIÓN DE UUID EXPLÍCITO Y BACKFILL ESTRICTO DE user_id
-- ==============================================================================

DO $$
DECLARE
    v_owner_raw text := nullif(trim(current_setting('app.owner_user_id', true)), '');
    v_owner_id uuid;
    v_alien_count int;
BEGIN
    -- 1. Exigir variable de sesión obligatoria
    IF v_owner_raw IS NULL THEN
        RAISE EXCEPTION 'Migración abortada: debe definir SET LOCAL app.owner_user_id = ''<UUID_PROPIETARIO>'' antes de ejecutar.';
    END IF;

    -- 2. Validar formato UUID
    BEGIN
        v_owner_id := v_owner_raw::uuid;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Migración abortada: app.owner_user_id (''%'') no es un UUID válido.', v_owner_raw;
    END;

    -- 3. Verificar existencia del usuario en auth.users
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner_id) THEN
        RAISE EXCEPTION 'Migración abortada: el usuario % no existe en auth.users.', v_owner_id;
    END IF;

    -- 4. Verificar integridad: no deben existir filas pertenecientes a un user_id ajeno
    SELECT COUNT(*) INTO v_alien_count FROM public.carteras WHERE user_id IS NOT NULL AND user_id <> v_owner_id;
    IF v_alien_count > 0 THEN
        RAISE EXCEPTION 'Migración abortada: existen % filas en carteras con user_id ajeno a %.', v_alien_count, v_owner_id;
    END IF;

    SELECT COUNT(*) INTO v_alien_count FROM public.transacciones WHERE user_id IS NOT NULL AND user_id <> v_owner_id;
    IF v_alien_count > 0 THEN
        RAISE EXCEPTION 'Migración abortada: existen % filas en transacciones con user_id ajeno a %.', v_alien_count, v_owner_id;
    END IF;

    SELECT COUNT(*) INTO v_alien_count FROM public.gastos_recurrentes WHERE user_id IS NOT NULL AND user_id <> v_owner_id;
    IF v_alien_count > 0 THEN
        RAISE EXCEPTION 'Migración abortada: existen % filas en gastos_recurrentes con user_id ajeno a %.', v_alien_count, v_owner_id;
    END IF;

    SELECT COUNT(*) INTO v_alien_count FROM public.catalogo_categorias WHERE user_id IS NOT NULL AND user_id <> v_owner_id;
    IF v_alien_count > 0 THEN
        RAISE EXCEPTION 'Migración abortada: existen % filas en catalogo_categorias con user_id ajeno a %.', v_alien_count, v_owner_id;
    END IF;

    SELECT COUNT(*) INTO v_alien_count FROM public.historico_patrimonio WHERE user_id IS NOT NULL AND user_id <> v_owner_id;
    IF v_alien_count > 0 THEN
        RAISE EXCEPTION 'Migración abortada: existen % filas en historico_patrimonio con user_id ajeno a %.', v_alien_count, v_owner_id;
    END IF;

    -- 5. Backfill asignado exclusivamente a filas con user_id NULL
    UPDATE public.carteras SET user_id = v_owner_id WHERE user_id IS NULL;
    UPDATE public.transacciones SET user_id = v_owner_id WHERE user_id IS NULL;
    UPDATE public.catalogo_categorias SET user_id = v_owner_id WHERE user_id IS NULL;
    UPDATE public.gastos_recurrentes SET user_id = v_owner_id WHERE user_id IS NULL;
    UPDATE public.historico_patrimonio SET user_id = v_owner_id WHERE user_id IS NULL;

    -- 6. Establecer DEFAULT auth.uid() y NOT NULL en las 5 tablas
    ALTER TABLE public.carteras ALTER COLUMN user_id SET DEFAULT auth.uid(), ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE public.transacciones ALTER COLUMN user_id SET DEFAULT auth.uid(), ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE public.catalogo_categorias ALTER COLUMN user_id SET DEFAULT auth.uid(), ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE public.gastos_recurrentes ALTER COLUMN user_id SET DEFAULT auth.uid(), ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE public.historico_patrimonio ALTER COLUMN user_id SET DEFAULT auth.uid(), ALTER COLUMN user_id SET NOT NULL;
END $$;

-- ==============================================================================
-- 5. PRE-VALIDACIÓN CONTABLE ESTRICTA (SIN TRUNCAMIENTO SILENCIOSO)
-- ==============================================================================

DO $$
DECLARE
    v_bad_count int;
BEGIN
    -- 1. Pre-validación en transacciones: monto IS NULL OR monto <= 0 OR monto <> trunc(monto)
    SELECT COUNT(*) INTO v_bad_count
    FROM public.transacciones
    WHERE monto IS NULL OR monto <= 0 OR monto <> trunc(monto);
    IF v_bad_count > 0 THEN
        RAISE EXCEPTION 'Pre-validación fallida en transacciones: % filas con monto <= 0 o fraccionario. Corrija explícitamente antes de migrar.', v_bad_count;
    END IF;

    -- 2. Pre-validación en gastos_recurrentes: monto IS NULL OR monto <= 0 OR monto <> trunc(monto)
    SELECT COUNT(*) INTO v_bad_count
    FROM public.gastos_recurrentes
    WHERE monto IS NULL OR monto <= 0 OR monto <> trunc(monto);
    IF v_bad_count > 0 THEN
        RAISE EXCEPTION 'Pre-validación fallida en gastos_recurrentes: % filas con monto <= 0 o fraccionario. Corrija explícitamente antes de migrar.', v_bad_count;
    END IF;

    -- 3. Pre-validación en catalogo_categorias: presupuesto_base IS NULL OR presupuesto_base < 0 OR presupuesto_base <> trunc(presupuesto_base)
    SELECT COUNT(*) INTO v_bad_count
    FROM public.catalogo_categorias
    WHERE presupuesto_base IS NULL OR presupuesto_base < 0 OR presupuesto_base <> trunc(presupuesto_base);
    IF v_bad_count > 0 THEN
        RAISE EXCEPTION 'Pre-validación fallida en catalogo_categorias: % filas con presupuesto_base < 0 o fraccionario. Corrija explícitamente antes de migrar.', v_bad_count;
    END IF;

    -- 4. Pre-validación en carteras: saldos nulos o fraccionarios
    SELECT COUNT(*) INTO v_bad_count
    FROM public.carteras
    WHERE saldo_inicial IS NULL OR saldo_actual IS NULL 
       OR saldo_inicial <> trunc(saldo_inicial) 
       OR saldo_actual <> trunc(saldo_actual);
    IF v_bad_count > 0 THEN
        RAISE EXCEPTION 'Pre-validación fallida en carteras: % filas con saldos fraccionarios o nulos. Corrija explícitamente antes de migrar.', v_bad_count;
    END IF;

    -- 5. Pre-validación en historico_patrimonio adaptativo
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'historico_patrimonio' AND column_name = 'total_activos'
    ) THEN
        SELECT COUNT(*) INTO v_bad_count
        FROM public.historico_patrimonio
        WHERE total_activos IS NULL OR total_pasivos IS NULL OR patrimonio_neto IS NULL
           OR total_activos <> trunc(total_activos) 
           OR total_pasivos <> trunc(total_pasivos) 
           OR patrimonio_neto <> trunc(patrimonio_neto);
        IF v_bad_count > 0 THEN
            RAISE EXCEPTION 'Pre-validación fallida en historico_patrimonio: % filas con importes fraccionarios o nulos. Corrija explícitamente antes de migrar.', v_bad_count;
        END IF;
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'historico_patrimonio' AND column_name = 'activos'
    ) THEN
        SELECT COUNT(*) INTO v_bad_count
        FROM public.historico_patrimonio
        WHERE activos IS NULL OR pasivos IS NULL OR patrimonio_neto IS NULL
           OR activos <> trunc(activos) 
           OR pasivos <> trunc(pasivos) 
           OR patrimonio_neto <> trunc(patrimonio_neto);
        IF v_bad_count > 0 THEN
            RAISE EXCEPTION 'Pre-validación fallida en historico_patrimonio: % filas con importes fraccionarios o nulos. Corrija explícitamente antes de migrar.', v_bad_count;
        END IF;
    END IF;
END $$;

-- ==============================================================================
-- 6. INSTALACIÓN DE CONSTRAINTS CHECK Y UNICIDAD MULTI-USUARIO
-- ==============================================================================

ALTER TABLE public.transacciones DROP CONSTRAINT IF EXISTS transacciones_monto_pesos_enteros;
ALTER TABLE public.transacciones DROP CONSTRAINT IF EXISTS chk_transacciones_monto;
ALTER TABLE public.transacciones ADD CONSTRAINT transacciones_monto_pesos_enteros CHECK (monto = trunc(monto) AND monto > 0);

ALTER TABLE public.gastos_recurrentes DROP CONSTRAINT IF EXISTS gastos_recurrentes_monto_pesos_enteros;
ALTER TABLE public.gastos_recurrentes DROP CONSTRAINT IF EXISTS chk_recurrentes_monto;
ALTER TABLE public.gastos_recurrentes ADD CONSTRAINT gastos_recurrentes_monto_pesos_enteros CHECK (monto = trunc(monto) AND monto > 0);

ALTER TABLE public.catalogo_categorias DROP CONSTRAINT IF EXISTS catalogo_presupuesto_pesos_enteros;
ALTER TABLE public.catalogo_categorias DROP CONSTRAINT IF EXISTS chk_catalogo_presupuesto;
ALTER TABLE public.catalogo_categorias ADD CONSTRAINT catalogo_presupuesto_pesos_enteros CHECK (presupuesto_base = trunc(presupuesto_base) AND presupuesto_base >= 0);

ALTER TABLE public.carteras DROP CONSTRAINT IF EXISTS carteras_saldos_pesos_enteros;
ALTER TABLE public.carteras DROP CONSTRAINT IF EXISTS chk_carteras_enteros;
ALTER TABLE public.carteras ADD CONSTRAINT carteras_saldos_pesos_enteros CHECK (saldo_inicial = trunc(saldo_inicial) AND saldo_actual = trunc(saldo_actual));

-- Unicidad por usuario
ALTER TABLE public.carteras DROP CONSTRAINT IF EXISTS carteras_nombre_key;
ALTER TABLE public.carteras DROP CONSTRAINT IF EXISTS uq_carteras_user_nombre;
ALTER TABLE public.carteras ADD CONSTRAINT uq_carteras_user_nombre UNIQUE (user_id, nombre);

ALTER TABLE public.catalogo_categorias DROP CONSTRAINT IF EXISTS uq_catalogo_macro_sub;
ALTER TABLE public.catalogo_categorias DROP CONSTRAINT IF EXISTS uq_catalogo_user_macro_sub;
ALTER TABLE public.catalogo_categorias ADD CONSTRAINT uq_catalogo_user_macro_sub UNIQUE (user_id, macro_categoria, subcategoria);

-- Constraint enteras adaptativo para historico_patrimonio
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'historico_patrimonio' AND column_name = 'total_activos'
    ) THEN
        ALTER TABLE public.historico_patrimonio DROP CONSTRAINT IF EXISTS historico_patrimonio_pesos_enteros;
        ALTER TABLE public.historico_patrimonio DROP CONSTRAINT IF EXISTS chk_historico_patrimonio_enteros;
        ALTER TABLE public.historico_patrimonio ADD CONSTRAINT historico_patrimonio_pesos_enteros 
            CHECK (total_activos = trunc(total_activos) AND total_pasivos = trunc(total_pasivos) AND patrimonio_neto = trunc(patrimonio_neto));
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'historico_patrimonio' AND column_name = 'activos'
    ) THEN
        ALTER TABLE public.historico_patrimonio DROP CONSTRAINT IF EXISTS historico_patrimonio_pesos_enteros;
        ALTER TABLE public.historico_patrimonio DROP CONSTRAINT IF EXISTS chk_historico_patrimonio_enteros;
        ALTER TABLE public.historico_patrimonio ADD CONSTRAINT historico_patrimonio_pesos_enteros 
            CHECK (activos = trunc(activos) AND pasivos = trunc(pasivos) AND patrimonio_neto = trunc(patrimonio_neto));
    END IF;
END $$;

-- ==============================================================================
-- 7. ÍNDICES ESTRATÉGICOS TRAS GARANTIZAR user_id Y NOT NULL
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_carteras_user_orden ON public.carteras (user_id, orden);
CREATE INDEX IF NOT EXISTS idx_transacciones_user_fecha ON public.transacciones (user_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_transacciones_user_ciclo ON public.transacciones (user_id, ciclo);
CREATE INDEX IF NOT EXISTS idx_transacciones_user_cuentas ON public.transacciones (user_id, cuenta_origen, cuenta_destino);
CREATE INDEX IF NOT EXISTS idx_catalogo_user_macro ON public.catalogo_categorias (user_id, macro_categoria);
CREATE INDEX IF NOT EXISTS idx_recurrentes_user_activo ON public.gastos_recurrentes (user_id, activo);
CREATE INDEX IF NOT EXISTS idx_historico_patrimonio_user_fecha ON public.historico_patrimonio (user_id, fecha DESC);

-- ==============================================================================
-- 8. FUNCIONES RPC
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.cycle_id_colombia(p_date TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_bogota_date TIMESTAMP;
    v_year INT;
    v_month INT;
    v_day INT;
    v_cycle_year INT;
    v_cycle_month INT;
BEGIN
    v_bogota_date := p_date AT TIME ZONE 'America/Bogota';
    v_year := EXTRACT(YEAR FROM v_bogota_date)::INT;
    v_month := EXTRACT(MONTH FROM v_bogota_date)::INT;
    v_day := EXTRACT(DAY FROM v_bogota_date)::INT;

    IF v_day >= 25 THEN
        v_cycle_year := v_year;
        v_cycle_month := v_month;
    ELSE
        v_cycle_month := v_month - 1;
        IF v_cycle_month < 1 THEN
            v_cycle_month := 12;
            v_cycle_year := v_year - 1;
        ELSE
            v_cycle_year := v_year;
        END IF;
    END IF;

    RETURN TO_CHAR(v_cycle_year, 'FM0000') || '-' || TO_CHAR(v_cycle_month, 'FM00');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cycle_id_colombia(TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cycle_id_colombia(TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.swap_carteras_orden(
    id_a TEXT,
    orden_a INT,
    id_b TEXT,
    orden_b INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user_id UUID;
    v_count_a INT;
    v_count_b INT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- Validar propiedad de id_a
    UPDATE public.carteras
    SET orden = orden_a, updated_at = NOW()
    WHERE id = id_a AND user_id = v_user_id;
    GET DIAGNOSTICS v_count_a = ROW_COUNT;

    IF v_count_a = 0 THEN
        RAISE EXCEPTION 'Cartera A no encontrada o no pertenece al usuario autenticado';
    END IF;

    -- Validar propiedad de id_b
    UPDATE public.carteras
    SET orden = orden_b, updated_at = NOW()
    WHERE id = id_b AND user_id = v_user_id;
    GET DIAGNOSTICS v_count_b = ROW_COUNT;

    IF v_count_b = 0 THEN
        RAISE EXCEPTION 'Cartera B no encontrada o no pertenece al usuario autenticado';
    END IF;

    RETURN true;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Fallo al intercambiar orden de carteras: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.swap_carteras_orden(TEXT, INT, TEXT, INT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.swap_carteras_orden(TEXT, INT, TEXT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_recurring_expenses_rpc()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user_id UUID;
    v_now_bogota TIMESTAMP;
    v_year INT;
    v_month INT;
    v_day INT;
    v_cycle_id TEXT;
    v_days_in_month INT;
    v_rec RECORD;
    v_effective_day INT;
    v_tx_id TEXT;
    v_count INT := 0;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    v_now_bogota := NOW() AT TIME ZONE 'America/Bogota';
    v_year := EXTRACT(YEAR FROM v_now_bogota)::INT;
    v_month := EXTRACT(MONTH FROM v_now_bogota)::INT;
    v_day := EXTRACT(DAY FROM v_now_bogota)::INT;

    v_cycle_id := public.cycle_id_colombia(NOW());

    v_days_in_month := EXTRACT(DAY FROM (DATE_TRUNC('month', v_now_bogota) + INTERVAL '1 month - 1 day'))::INT;

    FOR v_rec IN 
        SELECT * FROM public.gastos_recurrentes
        WHERE activo = true AND user_id = v_user_id
        FOR UPDATE
    LOOP
        v_effective_day := LEAST(v_rec.dia_pago, v_days_in_month);

        IF v_day >= v_effective_day AND (v_rec.ultimo_ciclo_ejecutado IS NULL OR v_rec.ultimo_ciclo_ejecutado != v_cycle_id) THEN
            v_tx_id := 'REC_' || v_rec.id || '_' || v_cycle_id;

            INSERT INTO public.transacciones (
                id,
                user_id,
                fecha,
                tipo,
                monto,
                macro_categoria,
                subcategoria,
                cuenta,
                cuenta_origen,
                cuenta_destino,
                detalle,
                ciclo
            ) VALUES (
                v_tx_id,
                v_user_id,
                NOW(),
                'GASTO',
                v_rec.monto,
                v_rec.macro_categoria,
                v_rec.subcategoria,
                v_rec.cuenta,
                v_rec.cuenta,
                NULL,
                'Débito automático programado: ' || v_rec.nombre,
                v_cycle_id
            ) ON CONFLICT (id) DO NOTHING;

            UPDATE public.gastos_recurrentes
            SET ultimo_ciclo_ejecutado = v_cycle_id
            WHERE id = v_rec.id AND user_id = v_user_id;

            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_recurring_expenses_rpc() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_recurring_expenses_rpc() TO authenticated;

-- ==============================================================================
-- 9. TRIGGER: RECALCULAR SALDOS DE CARTERAS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.recalcular_saldos_carteras()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user_id UUID;
    v_cuentas_afectadas TEXT[] := ARRAY[]::TEXT[];
    v_cuenta TEXT;
    v_entradas NUMERIC;
    v_salidas NUMERIC;
BEGIN
    v_user_id := COALESCE(NEW.user_id, OLD.user_id);
    IF v_user_id IS NULL THEN
        v_user_id := auth.uid();
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.cuenta_origen IS NOT NULL THEN v_cuentas_afectadas := array_append(v_cuentas_afectadas, NEW.cuenta_origen); END IF;
        IF NEW.cuenta_destino IS NOT NULL THEN v_cuentas_afectadas := array_append(v_cuentas_afectadas, NEW.cuenta_destino); END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.cuenta_origen IS NOT NULL THEN v_cuentas_afectadas := array_append(v_cuentas_afectadas, OLD.cuenta_origen); END IF;
        IF OLD.cuenta_destino IS NOT NULL THEN v_cuentas_afectadas := array_append(v_cuentas_afectadas, OLD.cuenta_destino); END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.cuenta_origen IS NOT NULL THEN v_cuentas_afectadas := array_append(v_cuentas_afectadas, OLD.cuenta_origen); END IF;
        IF OLD.cuenta_destino IS NOT NULL THEN v_cuentas_afectadas := array_append(v_cuentas_afectadas, OLD.cuenta_destino); END IF;
        IF NEW.cuenta_origen IS NOT NULL THEN v_cuentas_afectadas := array_append(v_cuentas_afectadas, NEW.cuenta_origen); END IF;
        IF NEW.cuenta_destino IS NOT NULL THEN v_cuentas_afectadas := array_append(v_cuentas_afectadas, NEW.cuenta_destino); END IF;
    END IF;

    FOREACH v_cuenta IN ARRAY (SELECT ARRAY(SELECT DISTINCT unnest(v_cuentas_afectadas)))
    LOOP
        SELECT COALESCE(SUM(monto), 0) INTO v_entradas
        FROM public.transacciones
        WHERE cuenta_destino = v_cuenta
          AND (v_user_id IS NULL OR user_id = v_user_id);

        SELECT COALESCE(SUM(monto), 0) INTO v_salidas
        FROM public.transacciones
        WHERE cuenta_origen = v_cuenta
          AND (v_user_id IS NULL OR user_id = v_user_id);

        UPDATE public.carteras
        SET saldo_actual = saldo_inicial + v_entradas - v_salidas,
            updated_at = NOW()
        WHERE nombre = v_cuenta
          AND (v_user_id IS NULL OR user_id = v_user_id);
    END LOOP;

    RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalcular_saldos_carteras() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_saldos_carteras() TO authenticated;

DROP TRIGGER IF EXISTS trg_recalcular_saldos_carteras ON public.transacciones;
CREATE TRIGGER trg_recalcular_saldos_carteras
AFTER INSERT OR UPDATE OR DELETE ON public.transacciones
FOR EACH ROW
EXECUTE FUNCTION public.recalcular_saldos_carteras();

-- ==============================================================================
-- 10. POLÍTICAS DE SEGURIDAD (RLS) ESTRICTAS POR PROPIETARIO
-- ==============================================================================

ALTER TABLE public.carteras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transacciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gastos_recurrentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_patrimonio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso total a carteras" ON public.carteras;
DROP POLICY IF EXISTS "Propietario carteras" ON public.carteras;
DROP POLICY IF EXISTS "propietario_carteras" ON public.carteras;
CREATE POLICY "propietario_carteras" ON public.carteras
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Acceso total a transacciones" ON public.transacciones;
DROP POLICY IF EXISTS "Propietario transacciones" ON public.transacciones;
DROP POLICY IF EXISTS "propietario_transacciones" ON public.transacciones;
CREATE POLICY "propietario_transacciones" ON public.transacciones
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Acceso total a catalogo_categorias" ON public.catalogo_categorias;
DROP POLICY IF EXISTS "Propietario catalogo_categorias" ON public.catalogo_categorias;
DROP POLICY IF EXISTS "propietario_catalogo_categorias" ON public.catalogo_categorias;
CREATE POLICY "propietario_catalogo_categorias" ON public.catalogo_categorias
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Acceso total a gastos_recurrentes" ON public.gastos_recurrentes;
DROP POLICY IF EXISTS "Propietario gastos_recurrentes" ON public.gastos_recurrentes;
DROP POLICY IF EXISTS "propietario_gastos_recurrentes" ON public.gastos_recurrentes;
CREATE POLICY "propietario_gastos_recurrentes" ON public.gastos_recurrentes
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Acceso total a historico_patrimonio" ON public.historico_patrimonio;
DROP POLICY IF EXISTS "Propietario historico_patrimonio" ON public.historico_patrimonio;
DROP POLICY IF EXISTS "propietario_historico_patrimonio" ON public.historico_patrimonio;
CREATE POLICY "propietario_historico_patrimonio" ON public.historico_patrimonio
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

-- ==============================================================================
-- 11. PERMISOS EXPLÍCITOS DE TABLAS
-- ==============================================================================

REVOKE ALL ON TABLE public.carteras FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.carteras TO authenticated;

REVOKE ALL ON TABLE public.transacciones FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.transacciones TO authenticated;

REVOKE ALL ON TABLE public.catalogo_categorias FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.catalogo_categorias TO authenticated;

REVOKE ALL ON TABLE public.gastos_recurrentes FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gastos_recurrentes TO authenticated;

REVOKE ALL ON TABLE public.historico_patrimonio FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.historico_patrimonio TO authenticated;

-- Habilitar REPLICA IDENTITY FULL para transmisiones Realtime precisas de deletes/updates
ALTER TABLE public.carteras REPLICA IDENTITY FULL;
ALTER TABLE public.transacciones REPLICA IDENTITY FULL;
ALTER TABLE public.gastos_recurrentes REPLICA IDENTITY FULL;
