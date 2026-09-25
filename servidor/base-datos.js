// Conexión a Postgres (Neon, Supabase o cualquier otro) cuando existe DATABASE_URL.
// Sin DATABASE_URL la app sigue guardando en archivos JSON como antes (ver almacen.js).
//
// DATABASE_URL=pglite:<carpeta> usa PGlite, un Postgres completo que corre dentro de Node:
// sirve para probar en la PC sin instalar nada (sin carpeta, vive sólo en memoria).
// Es una dependencia de desarrollo, así que en Render hay que usar un Postgres de verdad.
const URL_BASE = process.env.DATABASE_URL || '';

let motor = null;

function hayBaseDeDatos() {
  return Boolean(URL_BASE);
}

async function conectarPglite(carpeta) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(carpeta || undefined);
  await db.waitReady;
  const consultarCon = (quien) => async (sql, parametros) => (await quien.query(sql, parametros)).rows;
  return {
    consulta: consultarCon(db),
    transaccion: (tarea) => db.transaction((tx) => tarea(consultarCon(tx))),
    cerrar: () => db.close()
  };
}

function conectarPostgres() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: URL_BASE, max: 5, idleTimeoutMillis: 30000 });
  // Neon corta las conexiones quietas: sin esto, ese corte tiraba abajo el servidor.
  pool.on('error', (err) => console.error('Conexión a la base de datos cortada:', err.message));
  return {
    consulta: async (sql, parametros) => (await pool.query(sql, parametros)).rows,
    transaccion: async (tarea) => {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const resultado = await tarea(async (sql, parametros) => (await cliente.query(sql, parametros)).rows);
        await cliente.query('COMMIT');
        return resultado;
      } catch (err) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        cliente.release();
      }
    },
    cerrar: () => pool.end()
  };
}

// Devuelve { consulta(sql, parámetros) → filas, transaccion(tarea), cerrar() }, o null sin base de datos.
async function conectar() {
  if (!hayBaseDeDatos()) return null;
  if (!motor) {
    motor = URL_BASE.startsWith('pglite:') ? await conectarPglite(URL_BASE.slice('pglite:'.length)) : conectarPostgres();
    await motor.consulta('CREATE TABLE IF NOT EXISTS migraciones (nombre TEXT PRIMARY KEY, hecho TIMESTAMPTZ NOT NULL DEFAULT now())');
  }
  return motor;
}

async function desconectar() {
  if (motor) await motor.cerrar().catch(() => {});
  motor = null;
}

module.exports = { conectar, desconectar, hayBaseDeDatos };
