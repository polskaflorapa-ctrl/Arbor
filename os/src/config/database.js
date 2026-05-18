const { Pool } = require('pg');
const logger = require('./logger');
const { env } = require('./env');

const applyDatabaseNameOverride = (connectionString, databaseName) => {
  if (!connectionString || !databaseName) return connectionString;
  try {
    const parsed = new URL(connectionString);
    parsed.pathname = `/${databaseName}`;
    return parsed.toString();
  } catch {
    return connectionString;
  }
};

const resolvedDatabaseUrl = applyDatabaseNameOverride(env.DATABASE_URL, env.DB_NAME);

const poolConfig = resolvedDatabaseUrl
  ? {
      connectionString: resolvedDatabaseUrl,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host: env.DB_HOST || 'localhost',
      port: env.DB_PORT || 5432,
      database: env.DB_NAME || 'arbor_db',
      user: env.DB_USER || 'postgres',
      password: env.DB_PASSWORD || 'postgres',
    };

const pool = new Pool({
    ...poolConfig,
    max:                    Number(process.env.DB_POOL_MAX)              || 20,
    idleTimeoutMillis:      Number(process.env.DB_IDLE_TIMEOUT_MS)       || 30_000,
    connectionTimeoutMillis:Number(process.env.DB_CONNECT_TIMEOUT_MS)    || 5_000,
    statement_timeout:      Number(process.env.DB_STATEMENT_TIMEOUT_MS)  || 30_000,
});

pool.on('connect', () => {
    logger.info('Polaczono z baza danych PostgreSQL');
});

pool.on('error', (err) => {
    logger.error('Blad bazy danych', { message: err.message });
});

pool.testConnection = async () => {
    let client;
    try {
          client = await pool.connect();
          const result = await client.query('SELECT NOW() as time');
          logger.info('Test polaczenia udany', { time: result.rows[0].time });
          return true;
    } catch (err) {
          logger.error('Test polaczenia nieudany', { message: err.message });
          return false;
    } finally {
          if (client) {
                client.release();
          }
    }
};

module.exports = pool;
