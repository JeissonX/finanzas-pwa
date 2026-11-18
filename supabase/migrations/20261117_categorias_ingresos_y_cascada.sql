-- Migración: Catálogo unificado GASTO/INGRESO con renombrado en cascada
-- Aplicada en producción el 2026-11-17. Este archivo es documentación del estado
-- ya ejecutado; NO re-ejecutar en producción.

-- 1. Columnas nuevas en catalogo_categorias
ALTER TABLE public.catalogo_categorias
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'GASTO'
    CHECK (tipo IN ('GASTO', 'INGRESO'));

ALTER TABLE public.catalogo_categorias
  ADD COLUMN IF NOT EXISTS medio_pago_sugerido TEXT;

ALTER TABLE public.catalogo_categorias
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Nueva constraint de unicidad (incluye tipo)
ALTER TABLE public.catalogo_categorias
  DROP CONSTRAINT IF EXISTS uq_catalogo_user_macro_sub;

ALTER TABLE public.catalogo_categorias
  ADD CONSTRAINT uq_catalogo_user_tipo_macro_sub
    UNIQUE (user_id, tipo, macro_categoria, subcategoria);

-- 3. Consolidación de macros de GASTO en DB
-- Vivienda / Hogar + Servicios Públicos -> Vivienda y Servicios
UPDATE public.catalogo_categorias
  SET macro_categoria = 'Vivienda y Servicios'
  WHERE tipo = 'GASTO'
    AND macro_categoria IN ('Vivienda / Hogar', 'Servicios Públicos');

-- Ocio y Viajes + Suscripciones -> Ocio y Suscripciones
UPDATE public.catalogo_categorias
  SET macro_categoria = 'Ocio y Suscripciones'
  WHERE tipo = 'GASTO'
    AND macro_categoria IN ('Ocio y Viajes', 'Suscripciones');

-- Eliminar subcat obsoleta
DELETE FROM public.catalogo_categorias
  WHERE tipo = 'GASTO'
    AND macro_categoria = 'Inversión y Ahorro'
    AND subcategoria = 'Traslado a Bolsillo Ahorro';

-- 4. Seed de categorías de INGRESO
INSERT INTO public.catalogo_categorias (user_id, tipo, macro_categoria, subcategoria, presupuesto_base, activo)
SELECT auth.uid(), 'INGRESO', 'Ingresos Laborales', 'Salario / Honorarios', 0, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.catalogo_categorias
     WHERE tipo = 'INGRESO' AND macro_categoria = 'Ingresos Laborales' AND subcategoria = 'Salario / Honorarios'
  );

INSERT INTO public.catalogo_categorias (user_id, tipo, macro_categoria, subcategoria, presupuesto_base, activo)
SELECT auth.uid(), 'INGRESO', 'Ingresos Laborales', 'Bonos / Comisiones', 0, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.catalogo_categorias
     WHERE tipo = 'INGRESO' AND macro_categoria = 'Ingresos Laborales' AND subcategoria = 'Bonos / Comisiones'
  );

INSERT INTO public.catalogo_categorias (user_id, tipo, macro_categoria, subcategoria, presupuesto_base, activo)
SELECT auth.uid(), 'INGRESO', 'Otros Ingresos', 'Reembolsos', 0, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.catalogo_categorias
     WHERE tipo = 'INGRESO' AND macro_categoria = 'Otros Ingresos' AND subcategoria = 'Reembolsos'
  );

INSERT INTO public.catalogo_categorias (user_id, tipo, macro_categoria, subcategoria, presupuesto_base, activo)
SELECT auth.uid(), 'INGRESO', 'Otros Ingresos', 'Rendimientos / Dividendos', 0, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.catalogo_categorias
     WHERE tipo = 'INGRESO' AND macro_categoria = 'Otros Ingresos' AND subcategoria = 'Rendimientos / Dividendos'
  );

-- 5. RPC rename_categoria_cascade
CREATE OR REPLACE FUNCTION public.rename_categoria_cascade(
  p_tipo TEXT,
  p_old_macro TEXT,
  p_old_sub TEXT,
  p_new_macro TEXT,
  p_new_sub TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.catalogo_categorias
     SET macro_categoria = p_new_macro,
         subcategoria    = p_new_sub,
         updated_at      = NOW()
   WHERE user_id = auth.uid()
     AND tipo = p_tipo
     AND macro_categoria = p_old_macro
     AND subcategoria = p_old_sub;

  UPDATE public.transacciones
     SET macro_categoria = p_new_macro,
         subcategoria    = p_new_sub
   WHERE user_id = auth.uid()
     AND macro_categoria = p_old_macro
     AND subcategoria = p_old_sub;
END;
$$;

-- 6. RPC rename_macro_cascade
CREATE OR REPLACE FUNCTION public.rename_macro_cascade(
  p_tipo TEXT,
  p_old_macro TEXT,
  p_new_macro TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.catalogo_categorias
     SET macro_categoria = p_new_macro,
         updated_at      = NOW()
   WHERE user_id = auth.uid()
     AND tipo = p_tipo
     AND macro_categoria = p_old_macro;

  UPDATE public.transacciones
     SET macro_categoria = p_new_macro
   WHERE user_id = auth.uid()
     AND macro_categoria = p_old_macro;
END;
$$;
