// api/kvHelpers.js
// Upstash Redis helpers with robust skipping of empty values
const axios = require('axios');

let defaultKVClient = null;

/**
 * Create a KV client that uses:
 *  - writeToken for SET operations
 *  - readOnlyToken for GET operations
 *
 * @param {string} kvUrl           Upstash REST endpoint, e.g. https://xyz.upstash.io
 * @param {string} readOnlyToken   Upstash read-only token
 * @param {string} writeToken      Upstash write token
 */
function createKVClient(kvUrl, readOnlyToken, writeToken) {
  if (!kvUrl || !readOnlyToken || !writeToken) {
    throw new Error('KV URL, read-only token and write token must all be provided.');
  }

  /**
   * Set a key to a value in Upstash Redis via REST.
   */
  async function setKVValue(key, value, options = {}) {
    const body = (typeof value === 'object' && value !== null)
      ? JSON.stringify(value)
      : value.toString();

    const headers = {
      Authorization: `Bearer ${writeToken}`,
      'Content-Type': (typeof value === 'object') ? 'application/json' : 'text/plain',
    };

    let url = `${kvUrl}/set/${encodeURIComponent(key)}`;
    if (options.expirationTtl) {
      const params = new URLSearchParams({ expiration_ttl: options.expirationTtl });
      url += `?${params.toString()}`;
    }

    try {
      await axios.post(url, body, { headers });
      console.log(`✅ Upstash SET ${key}`);
    } catch (err) {
      console.error(`❌ Error setting Upstash key "${key}":`, err.response?.data || err.message);
      throw err;
    }
  }

  /**
   * Get a key’s value from Upstash Redis via REST.
   */
  async function getKVValue(key) {
    const headers = { Authorization: `Bearer ${readOnlyToken}` };
    const url = `${kvUrl}/get/${encodeURIComponent(key)}`;

    try {
      const resp = await axios.get(url, { headers });
      if (resp.status === 200 && resp.data?.result !== undefined) {
        console.log(`✅ Upstash GET ${key}`);
        return resp.data.result;
      } else {
        console.warn(`⚠️  Upstash key "${key}" not found.`);
        return null;
      }
    } catch (err) {
      if (err.response?.status === 404) {
        console.warn(`⚠️  Upstash key "${key}" not found (404).`);
        return null;
      }
      console.error(`❌ Error getting Upstash key "${key}":`, err.response?.data || err.message);
      throw err;
    }
  }

  return { setKVValue, getKVValue };
}

/**
 * Build (and cache) the default client using environment variables:
 *   KV_REST_API_URL,
 *   KV_REST_API_TOKEN,
 *   KV_REST_API_READ_ONLY_TOKEN
 */
async function getDefaultKVClient() {
  if (defaultKVClient) return defaultKVClient;

  const kvUrl         = process.env.KV_REST_API_URL;
  const writeToken    = process.env.KV_REST_API_TOKEN;
  const readOnlyToken = process.env.KV_REST_API_READ_ONLY_TOKEN || writeToken;

  if (!kvUrl || !writeToken) {
    throw new Error('Environment variables KV_REST_API_URL and KV_REST_API_TOKEN are required.');
  }

  defaultKVClient = createKVClient(kvUrl, readOnlyToken, writeToken);
  return defaultKVClient;
}

/**
 * Wrapper: set a key in your default Upstash Redis
 */
async function setKVValueWrapper(key, value, options = {}) {
  const client = await getDefaultKVClient();
  return client.setKVValue(key, value, options);
}

/**
 * Wrapper: get a key from your default Upstash Redis
 */
async function getKVValueWrapper(key) {
  const client = await getDefaultKVClient();
  return client.getKVValue(key);
}

/**
 * Parse a snippet of the form:
 *   KEY="value"
 *   OTHER="value2"
 * into { KEY: "value", OTHER: "value2" }
 */
function parseConfigSnippet(snippet) {
  return snippet
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && line.includes('='))
    .reduce((cfg, line) => {
      const [rawKey, ...rest] = line.split('=');
      const key = rawKey.trim();
      let val = rest.join('=').trim();
      // strip surrounding quotes if present
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      cfg[key] = val;
      return cfg;
    }, {});
}

/**
 * Connect and initialize your Upstash KV with:
 *  - all keys from the provided snippet
 *  - Vercel metadata: teamId, projectName, accessToken
 *
 * This will skip any empty values automatically.
 */
async function connectKVStore(teamId, projectName, accessToken, kvSnippet) {
  const config = parseConfigSnippet(kvSnippet);
  console.log('🛠️  Parsed Upstash env snippet:', config);

  const kvUrl      = config.KV_REST_API_URL;
  const writeToken = config.KV_REST_API_TOKEN;
  const readOnly   = config.KV_REST_API_READ_ONLY_TOKEN || writeToken;

  if (!kvUrl || !writeToken) {
    throw new Error('Snippet must include KV_REST_API_URL and KV_REST_API_TOKEN.');
  }

  const client = createKVClient(kvUrl, readOnly, writeToken);

  // 1) store all snippet-provided keys (skip empty)
  for (const [key, val] of Object.entries(config)) {
    if (typeof val === 'string' && val.trim().length > 0) {
      console.log(`💾 SET ${key}`);
      await client.setKVValue(key, val);
    } else {
      console.log(`⏭️  Skipping empty snippet key ${key}`);
    }
  }

  // 2) store Vercel metadata (only non-empty)
  if (teamId && teamId.trim().length > 0) {
    console.log(`💾 SET Vercel_Team_ID`);
    await client.setKVValue('Vercel_Team_ID', teamId.trim());
  } else {
    console.log('⏭️  No teamId provided; skipping Vercel_Team_ID');
  }

  console.log(`💾 SET Vercel_Project_Name`);
  await client.setKVValue('Vercel_Project_Name', projectName);

  console.log(`💾 SET Vercel_Access_Token`);
  await client.setKVValue('Vercel_Access_Token', accessToken);

  return 'KV Store connected and credentials saved successfully.';
}

module.exports = {
  createKVClient,
  getKVValue: getKVValueWrapper,
  setKVValue: setKVValueWrapper,
  connectKVStore,
  parseConfigSnippet,
};
