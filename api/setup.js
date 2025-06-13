// api/setup.js
// Fully updated to parse Upstash env.local snippet, provision all vars (including read-only token, Redis URLs, etc.), and include required `type` on every Vercel API request.

const axios = require('axios');
const {
  connectKVStore,
  parseConfigSnippet,
  getKVValue: getKVValueWrapper,
} = require('./kvHelpers');

module.exports = async (req, res) => {
  const { action, key } = req.query;

  // Only allow POST for connect, and GET for env checks or KV reads
  if (req.method !== 'POST' &&
      action !== 'check-env-vars' &&
      action !== 'get-kv-value'
  ) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    switch (action) {
      case 'connect-kvstore': {
        const { teamId, projectName, accessToken, kvSnippet } = req.body;
        const missing = [];
        if (!projectName) missing.push('Vercel Project Name');
        if (!accessToken) missing.push('Vercel Access Token');
        if (!kvSnippet) missing.push('Upstash Env Snippet');
        if (missing.length) {
          return res.status(400).json({
            error: `The following fields are required: ${missing.join(', ')}`
          });
        }

        try {
          // 1) Write into Upstash KV
          await connectKVStore(teamId, projectName, accessToken, kvSnippet);

          // 2) Parse snippet to get env values
          const config = parseConfigSnippet(kvSnippet);

          // 3) Provision into Vercel
          await setEnvironmentVariables(teamId, projectName, accessToken, config);

          // 4) Trigger redeployment
          await triggerRedeployment(teamId, projectName, accessToken);

          return res.status(200).json({
            message: 'KV Store connected, credentials saved, and redeployment triggered.'
          });
        } catch (err) {
          console.error('🔴 connect-kvstore error:', err.response?.data || err.message);
          const raw = err.response?.data || { message: err.message };
          return res.status(500).json({ error: raw });
        }
      }

      case 'check-env-vars': {
        return res.status(200).json({
          KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
          KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
          KV_REST_API_READ_ONLY_TOKEN: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
          REDIS_URL: Boolean(process.env.REDIS_URL),
          KV_URL: Boolean(process.env.KV_URL),
        });
      }

      case 'get-kv-value': {
        if (!key) {
          return res.status(400).json({ error: 'Key is required to retrieve a KV value.' });
        }
        try {
          const value = await getKVValueWrapper(key);
          return res.status(200).json({ value });
        } catch (err) {
          console.error(`Error retrieving KV value for key ${key}:`, err);
          return res.status(500).json({ error: `Failed to retrieve KV value: ${err.message}` });
        }
      }

      default:
        return res.status(400).json({ error: 'Invalid action.' });
    }
  } catch (err) {
    console.error('General error:', err);
    return res.status(500).json({ error: `Failed to perform setup: ${err.message}` });
  }
};

/**
 * Upserts every key→value from `config` plus Vercel metadata
 * into your Vercel project. Adds the required `type` field.
 */
async function setEnvironmentVariables(teamId, projectName, accessToken, config) {
  const params = {};
  if (teamId) params.teamId = teamId;

  const baseUrl = `https://api.vercel.com/v9/projects/${projectName}/env`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  // Fetch existing environment variables once
  const existingRes = await axios.get(baseUrl, { headers, params });
  const existingEnvs = existingRes.data.envs;

  // Helper to classify as sensitive
  const isEncrypted = (key) => key !== 'KV_REST_API_URL';

  // 1) Upsert snippet-provided keys
  for (const [key, value] of Object.entries(config)) {
    if (!value) continue;
    const body = {
      value,
      type: isEncrypted(key) ? 'encrypted' : 'plain',
      target: ['production'],
    };
    const existing = existingEnvs.find(e => e.key === key);
    if (existing) {
      await axios.patch(
        `${baseUrl}/${existing.id}`,
        body,
        { headers, params }
      );
    } else {
      await axios.post(
        baseUrl,
        { key, ...body },
        { headers, params }
      );
    }
  }

  // 2) Upsert Vercel metadata
  await upsert('Vercel_Project_Name', projectName);
  await upsert('Vercel_Access_Token', accessToken);
  if (teamId) await upsert('Vercel_Team_ID', teamId);

  async function upsert(key, value) {
    const body = { value, type: 'encrypted', target: ['production'] };
    const existing = existingEnvs.find(e => e.key === key);
    if (existing) {
      await axios.patch(
        `${baseUrl}/${existing.id}`,
        body,
        { headers, params }
      );
    } else {
      await axios.post(
        baseUrl,
        { key, ...body },
        { headers, params }
      );
    }
  }

  console.log('✅ Environment variables updated successfully.');
}

/**
 * Triggers a new production deployment via the Vercel API.
 */
async function triggerRedeployment(teamId, projectName, accessToken) {
  const params = {};
  if (teamId) params.teamId = teamId;

  // Fetch project info to get Git linkage
  const proj = await axios.get(
    `https://api.vercel.com/v9/projects/${projectName}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, params }
  ).then(r => r.data);

  if (!proj.link?.type || !proj.link?.repoId) {
    throw new Error('Project is not linked to a Git repository.');
  }
  const branch = proj.link.org?.defaultBranch || 'main';

  // Create a new deployment
  await axios.post(
    `https://api.vercel.com/v13/deployments`,
    {
      name: projectName,
      target: 'production',
      gitSource: { type: proj.link.type, repoId: proj.link.repoId, ref: branch },
    },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, params }
  );

  console.log('✅ Redeployment triggered successfully.');
}
