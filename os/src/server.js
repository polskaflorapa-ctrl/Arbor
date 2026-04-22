const pool = require('./config/database');
const { createApp } = require('./app');
const { env } = require('./config/env');
const logger = require('./config/logger');

const initDatabase = async () => {
  const fs = require('fs');
  const path = require('path');
  const migratePath = path.join(__dirname, '..', 'migrate.sql');
  if (!fs.existsSync(migratePath)) {
    logger.warn('migrate.sql nie znaleziony - pomijam migracje');
    return;
  }
  const sql = fs.readFileSync(migratePath, 'utf8');
  try {
    await pool.query(sql);
    logger.info('Migracja bazy zakonczona (migrate.sql)');
  } catch (err) {
    logger.warn('Blad migracji (niekrytyczny)', { message: err.message });
  }
};

const PORT = env.PORT;
const tasksRoutes = require('./routes/tasks');
const app = createApp();
let serverInstance = null;
let shutdownInProgress = false;

const startServer = async () => {
  try {
    const dbConnected = await pool.testConnection();
    if (!dbConnected) {
      throw new Error('Brak polaczenia z baza danych');
    }
    await initDatabase();
    try {
      if (tasksRoutes.runMigration) await tasksRoutes.runMigration();
    } catch (migErr) {
      logger.warn('Migracja tasks (niekrytyczna)', { message: migErr.message });
    }
    serverInstance = app.listen(PORT, '0.0.0.0', () => {
      logger.info('ARBOR-OS uruchomiony', { port: PORT, version: '2.1.0' });
    });
    return serverInstance;
  } catch (err) {
    logger.error('Blad uruchamiania', { message: err.message });
    process.exit(1);
  }
};

const stopServer = async () => {
  if (shutdownInProgress) return;
  shutdownInProgress = true;

  logger.info('Rozpoczynam graceful shutdown');

  await new Promise((resolve) => {
    if (!serverInstance) {
      resolve();
      return;
    }
    serverInstance.close(() => resolve());
  });

  await pool.end();
  logger.info('Serwer i polaczenia DB zostaly zamkniete');
};

const handleShutdownSignal = (signal) => {
  logger.warn('Otrzymano sygnal zakonczenia', { signal });
  stopServer()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Blad podczas zamykania', { message: error.message });
      process.exit(1);
    });
};

process.on('SIGINT', () => handleShutdownSignal('SIGINT'));
process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, stopServer };
