-- ==============================================================================
-- FINANZAS PWA - ESQUEMA DE BASE DE DATOS POSTGRESQL & SUPABASE
-- Versión: 3.0.0 (RLS por Propietario Autenticado, Restricciones Enteras COP & Atomicidad RPC)
-- TimeZone Canónica: America/Bogota (Corte Nómina: día 25)
-- ==============================================================================

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. TABLAS PRINCIPALES
-- ==============================================================================

-- 2.1 Carteras y Cuentas de Balance
CREATE TABLE IF NOT EXISTS public.carteras (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('debito', 'credito', 'inversion', 'efectivo', 'deuda', 'remunerado')),
    saldo_inicial NUMERIC NOT NULL DEFAULT 0,
    saldo_actual NUMERIC NOT NULL DEFAULT 0,
    icono TEXT DEFAULT '💳',
    orden INT NOT NULL DEFAULT 99,
    permite_gasto BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_carteras_user_nombre UNIQUE (user_id, nombre),
    CONSTRAINT chk_carteras_enteros CHECK (saldo_inicial = trunc(saldo_inicial) AND saldo_actual = trunc(saldo_actual))
);

-- 2.2 Transacciones de Ingreso, Gasto, Transferencia y Conciliación
CREATE TABLE IF NOT EXISTS public.transacciones (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_transacciones_monto CHECK (monto = trunc(monto) AND monto > 0)
);

-- Índices estratégicos para transacciones
CREATE INDEX IF NOT EXISTS idx_transacciones_user_fecha ON public.transacciones (user_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_transacciones_user_ciclo ON public.transacciones (user_id, ciclo);
CREATE INDEX IF NOT EXISTS idx_transacciones_user_cuentas ON public.transacciones (user_id, cuenta_origen, cuenta_destino);

-- 2.3 Catálogo Maestro de Categorías y Presupuestos Base
CREATE TABLE IF NOT EXISTS public.catalogo_categorias (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    macro_categoria TEXT NOT NULL,
    subcategoria TEXT NOT NULL,
    presupuesto_base NUMERIC NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT true,
    cuenta_defecto TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_catalogo_user_macro_sub UNIQUE (user_id, macro_categoria, subcategoria),
    CONSTRAINT chk_catalogo_presupuesto CHECK (presupuesto_base = trunc(presupuesto_base) AND presupuesto_base >= 0)
);

-- 2.4 Gastos Recurrentes Programados
CREATE TABLE IF NOT EXISTS public.gastos_recurrentes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    monto NUMERIC NOT NULL,
    macro_categoria TEXT NOT NULL,
    subcategoria TEXT NOT NULL,
    cuenta TEXT NOT NULL,
    dia_pago INT NOT NULL CHECK (dia_pago BETWEEN 1 AND 31),
    activo BOOLEAN NOT NULL DEFAULT true,
    ultimo_ciclo_ejecutado TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_recurrentes_monto CHECK (monto = trunc(monto) AND monto > 0)
);

CREATE INDEX IF NOT EXISTS idx_recurrentes_user_activo ON public.gastos_recurrentes (user_id, activo);

-- 2.5 Histórico de Patrimonio Neto
CREATE TABLE IF NOT EXISTS public.historico_patrimonio (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_activos NUMERIC NOT NULL DEFAULT 0,
    total_pasivos NUMERIC NOT NULL DEFAULT 0,
    patrimonio_neto NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_historico_patrimonio_enteros CHECK (
        total_activos = trunc(total_activos) AND
        total_pasivos = trunc(total_pasivos) AND
        patrimonio_neto = trunc(patrimonio_neto)
    )
);

CREATE INDEX IF NOT EXISTS idx_historico_patrimonio_user_fecha ON public.historico_patrimonio (user_id, fecha DESC);

-- ==============================================================================
-- 3. FUNCIONES RPC
-- ==============================================================================

-- 3.1 Cálculo del ciclo nómina en horario Colombia (Corte 25 - Formato 'YYYY-MM')
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

-- 3.2 Intercambio Transaccional y Seguro del Orden de Carteras
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

-- 3.3 Procesamiento Atómico de Gastos Recurrentes en Base de Datos
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

    -- Días reales en el mes actual en Bogotá (soporta bisiestos y meses cortos)
    v_days_in_month := EXTRACT(DAY FROM (DATE_TRUNC('month', v_now_bogota) + INTERVAL '1 month - 1 day'))::INT;

    FOR v_rec IN 
        SELECT * FROM public.gastos_recurrentes
        WHERE activo = true AND user_id = v_user_id
        FOR UPDATE
    LOOP
        v_effective_day := LEAST(v_rec.dia_pago, v_days_in_month);

        IF v_day >= v_effective_day AND (v_rec.ultimo_ciclo_ejecutado IS NULL OR v_rec.ultimo_ciclo_ejecutado != v_cycle_id) THEN
            v_tx_id := 'REC_' || v_rec.id || '_' || v_cycle_id;

            -- Inserción idempotente de la transacción asociada al usuario
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

            -- Actualizar el último ciclo ejecutado en el gasto recurrente del usuario
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
-- 4. TRIGGER: RECALCULAR SALDOS DE CARTERAS
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

    -- Recolectar nombres de cuentas impactadas
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

    -- Recalcular saldo_actual para cada cartera afectada del usuario correspondiente
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
-- 5. POLÍTICAS DE SEGURIDAD (RLS) ESTRICTAS POR PROPIETARIO
-- ==============================================================================

ALTER TABLE public.carteras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transacciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gastos_recurrentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_patrimonio ENABLE ROW LEVEL SECURITY;

-- Limpieza de políticas previas abiertas
DROP POLICY IF EXISTS "Acceso total a carteras" ON public.carteras;
DROP POLICY IF EXISTS "Propietario carteras" ON public.carteras;
CREATE POLICY "Propietario carteras" ON public.carteras
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Acceso total a transacciones" ON public.transacciones;
DROP POLICY IF EXISTS "Propietario transacciones" ON public.transacciones;
CREATE POLICY "Propietario transacciones" ON public.transacciones
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Acceso total a catalogo_categorias" ON public.catalogo_categorias;
DROP POLICY IF EXISTS "Propietario catalogo_categorias" ON public.catalogo_categorias;
CREATE POLICY "Propietario catalogo_categorias" ON public.catalogo_categorias
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Acceso total a gastos_recurrentes" ON public.gastos_recurrentes;
DROP POLICY IF EXISTS "Propietario gastos_recurrentes" ON public.gastos_recurrentes;
CREATE POLICY "Propietario gastos_recurrentes" ON public.gastos_recurrentes
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Acceso total a historico_patrimonio" ON public.historico_patrimonio;
DROP POLICY IF EXISTS "Propietario historico_patrimonio" ON public.historico_patrimonio;
CREATE POLICY "Propietario historico_patrimonio" ON public.historico_patrimonio
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

-- ==============================================================================
-- 6. PERMISOS EXPLÍCITOS DE TABLAS
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
