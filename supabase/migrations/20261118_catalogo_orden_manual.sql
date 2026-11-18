-- Migración: Reordenamiento manual de macrocategorías y subcategorías
-- Aplicada en producción el 2026-11-18. Este archivo documenta el estado ya ejecutado.

-- 1. Columnas de orden en catalogo_categorias
ALTER TABLE public.catalogo_categorias
  ADD COLUMN IF NOT EXISTS orden_macro INTEGER NOT NULL DEFAULT 99;

ALTER TABLE public.catalogo_categorias
  ADD COLUMN IF NOT EXISTS orden INTEGER NOT NULL DEFAULT 99;

-- 2. Índices para acelerar ordenamiento
CREATE INDEX IF NOT EXISTS idx_catalogo_orden_macro_sub
  ON public.catalogo_categorias (user_id, tipo, orden_macro, orden);

-- 3. RPC swap_macro_orden
CREATE OR REPLACE FUNCTION public.swap_macro_orden(
  p_tipo TEXT,
  p_macro_a TEXT,
  p_orden_a INTEGER,
  p_macro_b TEXT,
  p_orden_b INTEGER
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Actualizar todas las filas de la macro A con el nuevo orden_macro
  UPDATE public.catalogo_categorias
     SET orden_macro = p_orden_b,
         updated_at = NOW()
   WHERE user_id = auth.uid()
     AND tipo = p_tipo
     AND macro_categoria = p_macro_a;

  -- Actualizar todas las filas de la macro B con el orden anterior de A
  UPDATE public.catalogo_categorias
     SET orden_macro = p_orden_a,
         updated_at = NOW()
   WHERE user_id = auth.uid()
     AND tipo = p_tipo
     AND macro_categoria = p_macro_b;
END;
$$;

-- 4. RPC swap_subcategoria_orden
CREATE OR REPLACE FUNCTION public.swap_subcategoria_orden(
  p_id_a TEXT,
  p_orden_a INTEGER,
  p_id_b TEXT,
  p_orden_b INTEGER
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.catalogo_categorias
     SET orden = p_orden_b,
         updated_at = NOW()
   WHERE user_id = auth.uid()
     AND id = p_id_a;

  UPDATE public.catalogo_categorias
     SET orden = p_orden_a,
         updated_at = NOW()
   WHERE user_id = auth.uid()
     AND id = p_id_b;
END;
$$;
