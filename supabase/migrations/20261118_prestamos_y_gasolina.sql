-- Migración: Módulo de Préstamos / Cuentas por Cobrar
-- Aplicada en producción el 2026-11-18. Este archivo documenta el estado ya ejecutado en Supabase.

-- 1. Tabla public.prestamos
CREATE TABLE IF NOT EXISTS public.prestamos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    deudor TEXT NOT NULL,
    monto NUMERIC NOT NULL CHECK (monto > 0 AND monto = trunc(monto)),
    fecha_prestamo DATE NOT NULL DEFAULT CURRENT_DATE,
    cuenta_origen TEXT NOT NULL,
    cuenta_destino TEXT,
    nota TEXT,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'PAGADO')),
    fecha_pago DATE,
    tx_salida_id TEXT,
    tx_entrada_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prestamos_user_estado ON public.prestamos (user_id, estado, fecha_prestamo);

ALTER TABLE public.prestamos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "propietario_prestamos" ON public.prestamos;
CREATE POLICY "propietario_prestamos" ON public.prestamos
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prestamos TO authenticated;
ALTER TABLE public.prestamos REPLICA IDENTITY FULL;

-- 2. RPC crear_prestamo_rpc
CREATE OR REPLACE FUNCTION public.crear_prestamo_rpc(
  p_deudor TEXT,
  p_monto NUMERIC,
  p_fecha_prestamo DATE,
  p_cuenta_origen TEXT,
  p_nota TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prestamo_id UUID;
  v_tx_id UUID;
BEGIN
  -- Insertar transacción de salida (GASTO o TRANSFERENCIA de préstamo)
  INSERT INTO public.transacciones (
    user_id, tipo, monto, macro_categoria, subcategoria,
    cuenta_origen, cuenta_destino, detalle, fecha
  ) VALUES (
    auth.uid(), 'GASTO', p_monto, 'Varios', 'Préstamos Otorgados',
    p_cuenta_origen, NULL, 'Préstamo a ' || p_deudor || COALESCE(': ' || p_nota, ''),
    p_fecha_prestamo::timestamptz
  ) RETURNING id INTO v_tx_id;

  -- Crear registro de préstamo vinculado
  INSERT INTO public.prestamos (
    user_id, deudor, monto, fecha_prestamo, cuenta_origen, nota, estado, tx_salida_id
  ) VALUES (
    auth.uid(), p_deudor, p_monto, p_fecha_prestamo, p_cuenta_origen, p_nota, 'PENDIENTE', v_tx_id::text
  ) RETURNING id INTO v_prestamo_id;

  RETURN v_prestamo_id;
END;
$$;

-- 3. RPC cobrar_prestamo_rpc
CREATE OR REPLACE FUNCTION public.cobrar_prestamo_rpc(
  p_prestamo_id UUID,
  p_cuenta_destino TEXT,
  p_fecha_pago DATE DEFAULT CURRENT_DATE
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prestamo RECORD;
  v_tx_id UUID;
  v_fecha_efectiva DATE;
BEGIN
  SELECT * INTO v_prestamo FROM public.prestamos
   WHERE id = p_prestamo_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Préstamo no encontrado';
  END IF;

  IF v_prestamo.estado = 'PAGADO' THEN
    RAISE EXCEPTION 'El préstamo ya ha sido cobrado previamente';
  END IF;

  v_fecha_efectiva := COALESCE(p_fecha_pago, CURRENT_DATE);

  -- Registrar transacción de entrada (INGRESO por reembolso de préstamo)
  INSERT INTO public.transacciones (
    user_id, tipo, monto, macro_categoria, subcategoria,
    cuenta_origen, cuenta_destino, detalle, fecha
  ) VALUES (
    auth.uid(), 'INGRESO', v_prestamo.monto, 'Otros Ingresos', 'Préstamos Cobrados',
    NULL, p_cuenta_destino, 'Pago de préstamo: ' || v_prestamo.deudor || COALESCE(' (' || v_prestamo.nota || ')', ''),
    v_fecha_efectiva::timestamptz
  ) RETURNING id INTO v_tx_id;

  -- Marcar préstamo como pagado
  UPDATE public.prestamos
     SET estado = 'PAGADO',
         cuenta_destino = p_cuenta_destino,
         fecha_pago = v_fecha_efectiva,
         tx_entrada_id = v_tx_id::text,
         updated_at = NOW()
   WHERE id = p_prestamo_id AND user_id = auth.uid();
END;
$$;

-- 4. RPC eliminar_prestamo_rpc
CREATE OR REPLACE FUNCTION public.eliminar_prestamo_rpc(
  p_prestamo_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prestamo RECORD;
BEGIN
  SELECT * INTO v_prestamo FROM public.prestamos
   WHERE id = p_prestamo_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Préstamo no encontrado';
  END IF;

  -- Eliminar transacciones vinculadas si existen
  IF v_prestamo.tx_salida_id IS NOT NULL THEN
    DELETE FROM public.transacciones WHERE id::text = v_prestamo.tx_salida_id AND user_id = auth.uid();
  END IF;

  IF v_prestamo.tx_entrada_id IS NOT NULL THEN
    DELETE FROM public.transacciones WHERE id::text = v_prestamo.tx_entrada_id AND user_id = auth.uid();
  END IF;

  -- Eliminar el registro del préstamo
  DELETE FROM public.prestamos WHERE id = p_prestamo_id AND user_id = auth.uid();
END;
$$;

-- 5. Tabla public.tanqueadas
CREATE TABLE IF NOT EXISTS public.tanqueadas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    transaccion_id TEXT,
    vehiculo TEXT NOT NULL CHECK (vehiculo IN ('MAZDA_2', 'MOTOCICLETA')),
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    monto NUMERIC NOT NULL CHECK (monto > 0),
    kilometraje INTEGER CHECK (kilometraje IS NULL OR kilometraje >= 0),
    galones NUMERIC(8,3) CHECK (galones IS NULL OR galones > 0),
    precio_galon NUMERIC CHECK (precio_galon IS NULL OR precio_galon > 0),
    tanque_lleno BOOLEAN NOT NULL DEFAULT TRUE,
    estacion TEXT,
    nota TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tanqueadas_user_vehiculo_fecha ON public.tanqueadas (user_id, vehiculo, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_tanqueadas_transaccion_id ON public.tanqueadas (transaccion_id) WHERE transaccion_id IS NOT NULL;

ALTER TABLE public.tanqueadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "propietario_tanqueadas" ON public.tanqueadas;
CREATE POLICY "propietario_tanqueadas" ON public.tanqueadas
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tanqueadas TO authenticated;
ALTER TABLE public.tanqueadas REPLICA IDENTITY FULL;

-- 6. Trigger para eliminar tanqueada vinculada cuando se borra su transacción
CREATE OR REPLACE FUNCTION public.trg_delete_tanqueada_on_transaccion_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.id IS NOT NULL THEN
    DELETE FROM public.tanqueadas
     WHERE transaccion_id = OLD.id::text;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_transacciones_delete_tanqueada ON public.transacciones;
CREATE TRIGGER trg_transacciones_delete_tanqueada
  AFTER DELETE ON public.transacciones
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_delete_tanqueada_on_transaccion_delete();
