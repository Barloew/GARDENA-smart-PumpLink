// api/vercelUtils.js

const { getKVValue } = require('./kvHelpers');

const getProductionUrl = (req) => {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return `${protocol}://${host}`;
};

const getRedirectUrl = (req) => {
  const productionUrl = getProductionUrl(req);
  return `${productionUrl}/api/oauth?action=callback`;
};

const getWebhookUrl = (req) => {
  const productionUrl = getProductionUrl(req);
  return `${productionUrl}/api/webhook`; 
};

module.exports = {
  getProductionUrl,
  getRedirectUrl,
  getWebhookUrl,
};
