const { env } = require('./env');

const formatMeta = (meta = {}) => {
  const cleanMeta = Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined)
  );
  return JSON.stringify(cleanMeta);
};

const log = (level, message, meta) => {
  const line = `[${new Date().toISOString()}] [${level}] ${message} ${formatMeta(meta)}`;
  if (level === 'ERROR') {
    console.error(line);
    return;
  }
  if (level === 'WARN') {
    console.warn(line);
    return;
  }
  if (env.NODE_ENV !== 'test') {
    console.log(line);
  }
};

module.exports = {
  info: (message, meta) => log('INFO', message, meta),
  warn: (message, meta) => log('WARN', message, meta),
  error: (message, meta) => log('ERROR', message, meta),
};
