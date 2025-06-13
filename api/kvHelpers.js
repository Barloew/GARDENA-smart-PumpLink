// api/kvHelpers.js
// Updated to use Upstash REST API URL + both read-only and write tokens

const axios = require('axios');

let defaultKVClient = null;

/**
 * @param {string} kvUrl                   REST endpoint, e.g. https://...upstash.io
 * @param {string} readOnlyToken           Upstash read-only token
 * @param {string} writeToken              Upstash write token
 */
const createKVClient = (kvUrl, readOnlyToken, writeToken) => {
  if (!kvUrl || !readOnlyToken || !writeToken) {
    throw new Error('KV URL, read-only token and write token must be provided.');
  }

  const setKVValue = async (key, value, options = {}) => {
    const data = (typeof value === 'object' && value !== null)
      ? JSON.stringify(value)
      : value.toString();
    const headers = {
      Authorization: `Bearer ${writeToken}`,
      'Content-Type': typeof value === 'object' ? 'application/json' : 'text/plain'
    };
    const params = new URLSearchParams();
    if (options.expirationTtl) {
      params.append('expiration_ttl', options.expirationTtl);
    }
    const url = options.expirationTtl
      ? `${kvUrl}/set/${encodeURIComponent(key)}?${params}`
      : `${kvUrl}/set/${encodeURIComponent(key)}`;

    try {
      await axios.post(url, data, { headers });
      console.log(`KV Store: ${key} set successfully`);
    } catch (err) {
      console.error(`Error setting KV value for ${key}:`, err.response?.data || err.message);
      throw err;
    }
  };

  const getKVValue = async (key) => {
    try {
      const resp = await axios.get(`${kvUrl}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${readOnlyToken}` }
      });
      if (resp.status === 200 && resp.data?.result !== undefined) {
        console.log(`KV Store: Retrieved ${key}`);
        return resp.data.result;
      }
      console.warn(`KV Store: ${key} not found.`);
      return null;
    } catch (err) {
      if (err.response?.status === 404) {
        console.warn(`KV Store: ${key} not found.`);
        return null;
      }
      console.error(`Error retrieving KV value for ${key}:`, err.response?.data || err.message);
      throw err;
    }
  };

  return { setKVValue, getKVValue };
};

/**
 * Builds (and caches) a client using your Vercel env vars:
 *   KV_REST_API_URL,
 *   KV_REST_API_TOKEN,
 *   KV_REST_API_READ_ONLY_TOKEN
 */
const getDefaultKVClient = async () => {
  if (defaultKVClient) return defaultKVClient;

  const kvUrl = process.env.KV_REST_API_URL
    || process.env.INITIAL_KV_REST_API_URL;
  const writeToken = process.env.KV_REST_API_TOKEN
    || process.env.INITIAL_KV_REST_API_TOKEN;
  const readOnlyToken = process.env.KV_REST_API_READ_ONLY_TOKEN
    || writeToken;

  if (!kvUrl || !writeToken) {
    throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN must be set in env.');
  }

  defaultKVClient = createKVClient(kvUrl, readOnlyToken, writeToken);
  return defaultKVClient;
};

const setKVValueWrapper = async (key, value, options = {}) => {
  const client = await getDefaultKVClient();
  return client.setKVValue(key, value, options);
};

const getKVValueWrapper = async (key) => {
  const client = await getDefaultKVClient();
  return client.getKVValue(key);
};

const parseConfigSnippet = (snippet) => {
  return snippet
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && line.includes('='))
    .reduce((cfg, line) => {
      const [k, ...rest] = line.split('=');
      cfg[k.trim()] = rest.join('=').replace(/(^")|("$)/g, '');
      return cfg;
    }, {});
};

/**
 * Stores your Vercel/Upstash credentials inside the Upstash KV itself
 * so the setup API can write once and the runtime can always read back.
 */
const connectKVStore = async (teamId, projectName, accessToken, kvSnippet) => {
  const config = parseConfigSnippet(kvSnippet);
  const kvUrl = config.KV_REST_API_URL;
  const writeToken = config.KV_REST_API_TOKEN;
  const readOnlyToken = config.KV_REST_API_READ_ONLY_TOKEN || writeToken;

  if (!kvUrl || !writeToken) {
    throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN are required.');
  }

  const client = createKVClient(kvUrl, readOnlyToken, writeToken);

  // store your Vercel connection metadata
  await client.setKVValue('Vercel_Team_ID', teamId || '');
  await client.setKVValue('Vercel_Project_Name', projectName);
  await client.setKVValue('Vercel_Access_Token', accessToken);

  // store the full snippet so the runtime can re-provision if needed
  for (const [k, v] of Object.entries(config)) {
    await client.setKVValue(k, v);
  }

  return 'KV Store connected and credentials saved successfully.';
};

module.exports = {
  setKVValue: setKVValueWrapper,
  getKVValue: getKVValueWrapper,
  createKVClient,
  connectKVStore,
  parseConfigSnippet,
};
