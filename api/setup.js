// api/setup.js
// Updated to parse your Upstash env.local snippet and provision all vars (including read-only token, Redis URLs, etc.)

const axios = require('axios');
const {
  connectKVStore,
  parseConfigSnippet,
  getKVValue: getKVValueWrapper
} = require('./kvHelpers');

module.exports = async (req, res) => {
  const { action, key } = req.query;

  if (req.method !== 'POST'
      && action !== 'check-env-vars'
      && action !== 'get-kv-value'
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
          return res.status(400).json({ error: `The following fields are required: ${missing.join(', ')}` });
        }

        try {
          // write into your Upstash KV first
          await connectKVStore(teamId, projectName, accessToken, kvSnippet);

          // parse all five env vars from the snippet
          const config = parseConfigSnippet(kvSnippet);

          // provision them into Vercel
          await setEnvironmentVariables(teamId, projectName, accessToken, config);

          // finally trigger a redeployment
          await triggerRedeployment(teamId, projectName, accessToken);

          return res.status(200).json({
            message: 'KV Store connected, credentials saved, and redeployment triggered.'
          });
        } catch (err) {
          console.error('Error in connect-kvstore:', err);
          return res.status(500).json({ error: `Failed to connect KV Store: ${err.message}` });
        }
      }

      case 'check-env-vars': {
        const vars = {
          KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
          KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
          KV_REST_API_READ_ONLY_TOKEN: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
          REDIS_URL: Boolean(process.env.REDIS_URL),
          KV_URL: Boolean(process.env.KV_URL),
        };
        return res.status(200).json(vars);
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
 * Dynamically upserts every key→value from the parsed snippet into Vercel env.
 */
async function setEnvironmentVariables(teamId, projectName, accessToken, config) {
  try {
    const params = {};
    if (teamId) params.teamId = teamId;

    const baseUrl = `https://api.vercel.com/v9/projects/${projectName}/env`;

    for (const [key, value] of Object.entries(config)) {
      if (!value) continue;
      // check existing
      const listResp = await axios.get(baseUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params
      });
      const existing = listResp.data.envs.find(e => e.key === key);

      if (existing) {
        // patch
        await axios.patch(
          `${baseUrl}/${existing.id}`,
          { value, target: ['production'] },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        );
      } else {
        // create new
        await axios.post(
          baseUrl,
          { key, value, target: ['production'] },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        );
      }
    }
    console.log('Environment variables updated successfully.');
  } catch (err) {
    console.error('Error setting environment variables:', err.response?.data || err.message);
    throw new Error('Failed to set environment variables: ' + (err.response?.data?.error?.message || err.message));
  }
}

async function triggerRedeployment(teamId, projectName, accessToken) {
  try {
    const params = {};
    if (teamId) params.teamId = teamId;

    // fetch project info
    const proj = await axios.get(
      `https://api.vercel.com/v9/projects/${projectName}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, params }
    ).then(r => r.data);

    if (!proj.link?.type || !proj.link?.repoId) {
      throw new Error('Project is not linked to a Git repository.');
    }
    const branch = proj.link.org?.defaultBranch || 'main';

    // trigger
    await axios.post(
      `https://api.vercel.com/v13/deployments`,
      {
        name: projectName,
        target: 'production',
        gitSource: {
          type: proj.link.type,
          repoId: proj.link.repoId,
          ref: branch,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params
      }
    );
    console.log('Redeployment triggered successfully.');
  } catch (err) {
    console.error('Error triggering redeployment:', err.response?.data || err.message);
    throw new Error('Failed to trigger redeployment: ' + (err.response?.data?.error?.message || err.message));
  }
}
