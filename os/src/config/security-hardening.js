const logger = require('./logger');

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function productionSecurityIssues(env) {
  if (env.NODE_ENV !== 'production') return [];

  const issues = [];
  const corsOrigins = splitCsv(env.CORS_ORIGINS);
  if (!corsOrigins.length || corsOrigins.includes('*')) {
    issues.push('CORS_ORIGINS must be set to explicit origins in production.');
  }

  if (env.METRICS_ENABLED && !String(process.env.METRICS_TOKEN || '').trim()) {
    issues.push('METRICS_TOKEN must be set when METRICS_ENABLED is true in production.');
  }

  if (env.TWILIO_AUTH_TOKEN && !env.PUBLIC_BASE_URL) {
    issues.push('PUBLIC_BASE_URL must be set when TWILIO_AUTH_TOKEN is configured.');
  }

  if (env.TWILIO_AUTH_TOKEN && env.TWILIO_SKIP_SIGNATURE_VALIDATION) {
    issues.push('TWILIO_SKIP_SIGNATURE_VALIDATION must be false in production.');
  }

  if (env.ZADARMA_API_SECRET && env.ZADARMA_SKIP_SIGNATURE_VALIDATION) {
    issues.push('ZADARMA_SKIP_SIGNATURE_VALIDATION must be false in production.');
  }

  return issues;
}

function assertProductionSecurityConfig(env) {
  const issues = productionSecurityIssues(env);
  if (!issues.length) return;
  const message = `Unsafe production security configuration:\n- ${issues.join('\n- ')}`;
  logger.error('security.production_config_invalid', { issues });
  throw new Error(message);
}

module.exports = {
  assertProductionSecurityConfig,
  productionSecurityIssues,
};
