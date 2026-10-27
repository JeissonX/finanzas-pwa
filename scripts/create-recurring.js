import pg from 'pg';
const { Client } = pg;

const PROJECT_REF = 'mgxswkeujizsosmkskav';
const password = process.env.SUPABASE_DB_PASS || process.argv[2];

const sql = `
-- 1. Tabla de gastos recurrentes programados
CREATE TABLE IF NOT EXISTS public.gastos_recurrentes (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    monto NUMERIC NOT NULL CHECK (monto > 0),
    macro_categoria TEXT NOT NULL,
    subcategoria TEXT NOT NULL,
    cuenta TEXT NOT NULL,
    dia_pago INT NOT NULL CHECK (dia_pago BETWEEN 1 AND 31),
    activo BOOLEAN NOT NULL DEFAULT true,
    ultimo_ciclo_ejecutado TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.gastos_recurrentes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Acceso total a gastos_recurrentes" ON public.gastos_recurrentes;
CREATE POLICY "Acceso total a gastos_recurrentes" ON public.gastos_recurrentes FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE public.gastos_recurrentes REPLICA IDENTITY FULL;

-- 2. Insertar ejemplo inicial de YouTube Premium
INSERT INTO public.gastos_recurrentes (id, nombre, monto, macro_categoria, subcategoria, cuenta, dia_pago, activo)
VALUES ('rec-yt-premium', 'YouTube Premium', 20900, 'Suscripciones', 'Streaming y Apps Digitales', 'TC Lulo Bank', 12, true)
ON CONFLICT (id) DO NOTHING;
`;

async function run() {
  if (!password && !process.env.DATABASE_URL) {
    console.error('Error: Se requiere SUPABASE_DB_PASS o DATABASE_URL.');
    process.exit(1);
  }

  // Intentar conexión directa o pooler
  const connectionStrings = process.env.DATABASE_URL
    ? [process.env.DATABASE_URL]
    : [
        `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`,
        `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(password)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
        `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(password)}@aws-0-us-east-2.pooler.supabase.com:6543/postgres`,
        `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(password)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`,
      ];

  let client = null;
  let lastErr = null;

  for (const connStr of connectionStrings) {
    try {
      console.log('Intentando conectar con:', connStr.replace(/:[^:@]+@/, ':****@'));
      client = new Client({
        connectionString: connStr,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 8000,
      });
      await client.connect();
      console.log('Conexión exitosa a PostgreSQL');
      break;
    } catch (err) {
      lastErr = err;
      console.warn('Fallo intento:', err.message);
      if (client) {
        try { await client.end(); } catch {}
        client = null;
      }
    }
  }

  if (!client) {
    console.error('No se pudo establecer conexión con ninguna URL:', lastErr);
    process.exit(1);
  }

  try {
    console.log('Ejecutando migración SQL...');
    await client.query(sql);
    console.log('--- Migración completada exitosamente ---');
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
