// api/kvHelpers.js

const axios = require('axios');

const createKVClient = (kvUrl, kvToken) => {
  if (!kvUrl || !kvToken) {
    throw new Error('KV URL and Token must be provided to create a KV client.');
  }

  const setKVValue = async (key, value, options = {}) => {
    let data;
    let headers = { Authorization: `Bearer ${kvToken}` };

    if (typeof value === 'object' && value !== null) {
      data = JSON.stringify(value);
      headers['Content-Type'] = 'application/json';
    } else {
      data = value.toString(); 
      headers['Content-Type'] = 'text/plain';
    }

    const params = new URLSearchParams();
    if (options.expirationTtl) {
      params.append('expiration_ttl', options.expirationTtl);
    }

    try {
      const url = options.expirationTtl
        ? `${kvUrl}/set/${encodeURIComponent(key)}?${params.toString()}`
        : `${kvUrl}/set/${encodeURIComponent(key)}`;

      await axios.post(url, data, { headers });
      console.log(`KV Store: ${key} set successfully`);
    } catch (error) {
      console.error(
        `Error setting KV Store value for ${key}:`,
        error.response?.data || error.message
      );
      throw error;
    }
  };

  const getKVValue = async (key) => {
    try {
      const response = await axios.get(`${kvUrl}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });

      if (response.status === 200 && response.data !== undefined) {
        const data = response.data.result;
        console.log(`KV Store: Retrieved key=${key}, data=${data}`);
        return data;
      } else {
        console.warn(`KV Store: ${key} not found.`);
        return null;
      }
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.warn(`KV Store: ${key} not found.`);
        return null;
      }
      console.error(
        `Error retrieving KV Store value for ${key}:`,
        error.response?.data || error.message
      );
      throw error;
    }
  };

  return { setKVValue, getKVValue };
};

let defaultKVClient = null;

const getDefaultKVClient = async () => {
  const kvUrl = process.env.KV_REST_API_URL || process.env.INITIAL_KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.INITIAL_KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN must be set as environment variables.');
  }

  defaultKVClient = createKVClient(kvUrl, kvToken);
  return defaultKVClient;
};

const setKVValueWrapper = async (key, value, options = {}) => {
  const kvClient = await getDefaultKVClient();
  return kvClient.setKVValue(key, value, options);
};

const getKVValueWrapper = async (key) => {
  const kvClient = await getDefaultKVClient();
  return kvClient.getKVValue(key);
};

const parseConfigSnippet = (snippet) => {
  const lines = snippet.split('\n');
  const config = {};

  lines.forEach((line) => {
    const [key, value] = line.split('=');
    if (key && value) {
      config[key.trim()] = value.trim().replace(/"/g, '');
    }
  });

  return config;
};

const connectKVStore = async (teamId, projectName, accessToken, kvSnippet) => {
  const config = parseConfigSnippet(kvSnippet);

  const kvUrl = config.KV_REST_API_URL;
  const kvToken = config.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN are required in the KV Snippet.');
  }

  const customKVClient = createKVClient(kvUrl, kvToken);

  await customKVClient.setKVValue('Vercel_Team_ID', teamId && teamId.trim() !== '' ? teamId : '');
  await customKVClient.setKVValue('Vercel_Project_Name', projectName);
  await customKVClient.setKVValue('Vercel_Access_Token', accessToken);

  await customKVClient.setKVValue('KV_REST_API_URL', kvUrl);
  await customKVClient.setKVValue('KV_REST_API_TOKEN', kvToken);

  return 'KV Store connected and credentials saved successfully.';
};

module.exports = {
  setKVValue: setKVValueWrapper,
  getKVValue: getKVValueWrapper,
  createKVClient,
  connectKVStore,
  parseConfigSnippet,
};
