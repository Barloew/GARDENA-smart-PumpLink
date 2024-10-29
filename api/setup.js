// api/setup.js

const { connectKVStore, parseConfigSnippet, getKVValue: getKVValueWrapper } = require('./kvHelpers');
const axios = require('axios');

module.exports = async (req, res) => {
  const { action, key } = req.query;

  if (req.method !== 'POST' && action !== 'check-env-vars' && action !== 'get-kv-value') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    switch (action) {
      case 'connect-kvstore': {
        const { teamId, projectName, accessToken, kvSnippet } = req.body;

        if (!projectName || !accessToken || !kvSnippet) {
          const missingFields = [];
          if (!projectName) missingFields.push('Vercel Project Name');
          if (!accessToken) missingFields.push('Vercel Access Token');
          if (!kvSnippet) missingFields.push('Gardena KV Snippet');
          return res.status(400).json({ error: `The following fields are required: ${missingFields.join(', ')}` });
        }

        try {
          await connectKVStore(teamId, projectName, accessToken, kvSnippet);

          const config = parseConfigSnippet(kvSnippet);
          const kvUrl = config.KV_REST_API_URL;
          const kvToken = config.KV_REST_API_TOKEN;

          if (!kvUrl || !kvToken) {
            throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN are required in the KV Snippet.');
          }

          await setEnvironmentVariables(teamId, projectName, accessToken, kvUrl, kvToken);
          await triggerRedeployment(teamId, projectName, accessToken);

          return res.status(200).json({ message: 'KV Store connected, credentials saved, and redeployment triggered.' });
        } catch (error) {
          console.error('Error in connect-kvstore:', error);
          return res.status(500).json({ error: `Failed to connect KV Store: ${error.message}` });
        }
      }

      case 'check-env-vars': {
        const kvUrl = process.env.KV_REST_API_URL;
        const kvToken = process.env.KV_REST_API_TOKEN;

        return res.status(200).json({
          KV_REST_API_URL: Boolean(kvUrl),
          KV_REST_API_TOKEN: Boolean(kvToken),
        });
      }

      case 'get-kv-value': {
        if (!key) {
          return res.status(400).json({ error: 'Key is required to retrieve a KV value.' });
        }

        try {
          const value = await getKVValueWrapper(key);
          return res.status(200).json({ value });
        } catch (error) {
          console.error(`Error retrieving KV value for key ${key}:`, error);
          return res.status(500).json({ error: `Failed to retrieve KV value: ${error.message}` });
        }
      }

      default:
        return res.status(400).json({ error: 'Invalid action.' });
    }
  } catch (error) {
    console.error('General error:', error);
    return res.status(500).json({ error: `Failed to perform setup: ${error.message}` });
  }
};

async function setEnvironmentVariables(teamId, projectName, accessToken, kvUrl, kvToken) {
  try {
    const params = {};
    if (teamId && teamId.trim() !== '') {
      params.teamId = teamId;
    }

    const url = `https://api.vercel.com/v9/projects/${projectName}/env`;

    const envVars = [
      { key: 'KV_REST_API_URL', value: kvUrl },
      { key: 'KV_REST_API_TOKEN', value: kvToken },
    ];

    for (const { key, value } of envVars) {
      const envVarExists = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params,
      });

      const existingEnvVar = envVarExists.data.envs.find((env) => env.key === key);

      if (existingEnvVar) {
        await axios.patch(
          `${url}/${existingEnvVar.id}`,
          { value, target: ['production'] },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        );
      } else {
        await axios.post(
          url,
          { key, value, target: ['production'] },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        );
      }
    }
    console.log('Environment variables updated successfully.');
  } catch (error) {
    console.error('Error setting environment variables:', error.response?.data || error.message);
    throw new Error('Failed to set environment variables: ' + (error.response?.data?.error?.message || error.message));
  }
}

async function triggerRedeployment(teamId, projectName, accessToken) {
  try {
    const params = {};
    if (teamId && teamId.trim() !== '') {
      params.teamId = teamId;
    }

    const projectApiUrl = `https://api.vercel.com/v9/projects/${projectName}`;
    const projectResponse = await axios.get(projectApiUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params,
    });

    const projectData = projectResponse.data;

    if (!projectData.link || !projectData.link.type) {
      throw new Error('The project is not linked to a Git repository.');
    }

    const repoId = projectData.link.repoId;
    const gitProvider = projectData.link.type;
    const gitBranch = projectData.link.org.defaultBranch || 'main';

    if (!repoId || !gitProvider || !gitBranch) {
      throw new Error('Failed to retrieve Git details from project data.');
    }

    const deploymentApiUrl = `https://api.vercel.com/v13/deployments`;
    const requestBody = {
      name: projectName,
      target: 'production',
      gitSource: {
        type: gitProvider,
        repoId: repoId,
        ref: gitBranch,
      },
    };

    const deploymentResponse = await axios.post(
      deploymentApiUrl,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        params,
      }
    );

    console.log('Redeployment triggered successfully:', deploymentResponse.data);
  } catch (error) {
    console.error('Error triggering redeployment:', error.response?.data || error.message);
    throw new Error('Failed to trigger redeployment: ' + (error.response?.data?.error?.message || error.message));
  }
}
