const { resolveLocale, translate, translateVars } = require('../i18n');

const localeMiddleware = (req, res, next) => {
  const locale = resolveLocale(req.headers['accept-language'], req.query?.lang);
  req.locale = locale;
  res.setHeader('content-language', locale);
  req.t = (key) => translate(locale, key);
  req.tv = (key, vars) => translateVars(locale, key, vars);
  next();
};

module.exports = { localeMiddleware };
