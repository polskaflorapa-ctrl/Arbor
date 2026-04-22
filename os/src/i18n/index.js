const pl = require('./pl.json');

/** API obsługuje wyłącznie język polski — nagłówki Accept-Language i ?lang= są ignorowane. */
const resolveLocale = () => 'pl';

const getNested = (bundle, dottedKey) => {
  const parts = dottedKey.split('.');
  let cur = bundle;
  for (const p of parts) {
    cur = cur?.[p];
  }
  return cur;
};

const translate = (_locale, key) => {
  const value = getNested(pl, key);
  return typeof value === 'string' ? value : key;
};

const translateVars = (_locale, key, vars = {}) => {
  let s = translate('pl', key);
  Object.entries(vars).forEach(([k, v]) => {
    s = s.split(`{{${k}}}`).join(String(v));
  });
  return s;
};

module.exports = {
  LOCALES: { pl },
  SUPPORTED_LOCALES: ['pl'],
  resolveLocale,
  translate,
  translateVars,
};
