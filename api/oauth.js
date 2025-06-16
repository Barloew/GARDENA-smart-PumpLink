//api/oauth.js
const axios = require('axios');
const { setKVValue, getKVValue } = require('./kvHelpers');
const { getRedirectUrl } = require('./vercelUtils');

const logMessage = (message) => {
  console.log(`${new Date().toISOString()} - ${message}`);
};

async function oauthHandler(req, res) {
  const { action } = req.query;

  try {
    switch (action) {
      case 'callback': {
        const { code } = req.query;
        if (!code) {
          console.error('No authorization code found in callback');
          return res.status(400).send('Authorization code is missing.');
        }

        try {
          const redirectUrl = getRedirectUrl(req);
          await getAccessTokenByCode(code, redirectUrl);
          await setKVValue('webhookRegistered', 'true');
          res.status(302).redirect('/overview.html');
          console.log('OAuth callback processed successfully.');
        } catch (error) {
          await setKVValue('webhookRegistered', 'false');
          console.error('Error during OAuth callback:', error.message);
          res.status(500).send(`Error during authorization: ${error.message}`);
        }
        break;
      }

      case 'refreshAccessToken': {
        try {
          const accessToken = await refreshAccessToken();
          return res.status(200).json({ accessToken });
        } catch (error) {
          console.error('Error refreshing access token:', error.message);
          return res.status(500).json({ error: 'Failed to refresh access token.' });
        }
      }

      case 'checkAndRefreshToken': {
        try {
          await checkAndRefreshToken();
          return res.status(200).json({ message: 'Token is valid or has been refreshed.' });
        } catch (error) {
          console.error('Error checking and refreshing token:', error.message);
          return res.status(500).json({ error: 'Failed to check or refresh token.' });
        }
      }

      default:
        res.status(400).json({ error: 'Invalid action.' });
    }
  } catch (error) {
    logMessage(`Error in OAuth process: ${error.message}`);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function checkAndRefreshToken() {
  const expiresAt = await getKVValue('gardenaAuthTokenExpiresAt');

  if (!expiresAt) {
    console.warn('No token expiry time found. Refreshing token.');
    await refreshAccessToken();
    return;
  }

  const currentTime = Date.now();
  const expiresInMs = parseInt(expiresAt, 10) - currentTime;
  const sixtyMinutesInMs = 60 * 60 * 1000;

  if (expiresInMs < sixtyMinutesInMs) {
    console.log('Token will expire soon. Refreshing token.');
    await refreshAccessToken();
  } else {
    console.log('Token is still valid. No refresh needed.');
  }
}

async function getAccessTokenByCode(code, redirectUrl) {
  const AUTH_HOST     = await getKVValue('gardenaAuthHost');
  const CLIENT_ID     = await getKVValue('gardenaClientId');
  const CLIENT_SECRET = await getKVValue('gardenaClientSecret');

  const params = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  redirectUrl,
  });

  try {
    const response = await axios.post(`${AUTH_HOST}/v1/oauth2/token`, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const data = response.data;
    await storeAccessToken(data);
    console.log('Access token obtained and stored successfully.');
    return data;
  } catch (error) {
    console.error('Error in getAccessTokenByCode:', error.message);
    throw new Error('Failed to obtain access token');
  }
}

async function refreshAccessToken() {
  const AUTH_HOST    = await getKVValue('gardenaAuthHost');
  const CLIENT_ID    = await getKVValue('gardenaClientId');
  const REFRESH_TOKEN = await getKVValue('gardenaRefreshToken');

  if (!AUTH_HOST || !CLIENT_ID || !REFRESH_TOKEN) {
    throw new Error('Missing required authentication parameters.');
  }

  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     CLIENT_ID,
    refresh_token: REFRESH_TOKEN,
  });

  console.log('Attempting to refresh access token.');

  try {
    const response = await axios.post(`${AUTH_HOST}/v1/oauth2/token`, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const data = response.data;

    if (!data.access_token || !data.expires_in) {
      throw new Error('Invalid response from token refresh endpoint.');
    }

    await storeAccessToken(data);
    console.log('Token refreshed and stored successfully.');
    return data.access_token;
  } catch (error) {
    console.error('Failed to refresh token:', error.response?.data || error.message);
    throw new Error(`Failed to refresh token: ${error.response?.data || error.message}`);
  }
}

async function storeAccessToken(data) {
  const { access_token, refresh_token, expires_in, user_id } = data;
  const expires_at = Date.now() + expires_in * 1000;

  await setKVValue('gardenaAuthToken', access_token);
  await setKVValue('gardenaRefreshToken', refresh_token);
  await setKVValue('gardenaAuthTokenExpiresAt', expires_at.toString());

  if (user_id) {
    await setKVValue('gardenaUserId', user_id);
  }

  const locationId = await getLocationId(access_token);
  await setKVValue('gardenaLocation', locationId);
  console.log('Access token and location ID stored successfully.');

  // Fetch and store garden details (pumps & valves) using v2 API
  await getGardenInfo();
}

async function getLocationId(accessToken) {
  const SMART_HOST = await getKVValue('gardenaSmartHost');
  const CLIENT_ID  = await getKVValue('gardenaClientId');

  try {
    const response = await axios.get(`${SMART_HOST}/v2/locations`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type':    'application/vnd.api+json',
        'X-Api-Key':        CLIENT_ID,
      },
    });

    if (response.data && response.data.data && response.data.data.length > 0) {
      console.log('Location ID retrieved successfully.');
      return response.data.data[0].id;
    } else {
      throw new Error('Failed to retrieve location ID');
    }
  } catch (error) {
    console.error('Error fetching location ID:', error.response?.data || error.message);
    throw new Error('Failed to retrieve location ID');
  }
}

async function getGardenInfo() {
  const authToken  = await getKVValue('gardenaAuthToken');
  const locationId = await getKVValue('gardenaLocation');
  const SMART_HOST = await getKVValue('gardenaSmartHost');
  const CLIENT_ID  = await getKVValue('gardenaClientId');

  if (!authToken || !locationId || !SMART_HOST) {
    throw new Error('Missing required Gardena credentials in KV store');
  }

  const headers = {
    Authorization: `Bearer ${authToken}`,
    'Content-Type':    'application/vnd.api+json',
    'X-Api-Key':        CLIENT_ID,
  };

  const resp = await axios.get(
    `${SMART_HOST}/v2/locations/${locationId}`,
    { headers }
  );

  if (resp.status !== 200 || !resp.data || !Array.isArray(resp.data.included)) {
    throw new Error('Failed to retrieve Garden Info or unexpected payload shape');
  }

  // Filter out only the pumps & valves services
  const pumpsAndValvesData = resp.data.included.filter(item =>
    ['VALVE', 'VALVE_SET', 'POWER_SOCKET'].includes(item.type)
  );

  const serialized = JSON.stringify(pumpsAndValvesData);
  console.log(`Storing ${serialized.length} bytes of pumps & valves data`);
  await setKVValue('gardenaPumpsAndValves', serialized);

  console.log('Pumps and valves data fetched and stored successfully.');
  return pumpsAndValvesData;
}

module.exports = oauthHandler;
module.exports.checkAndRefreshToken = checkAndRefreshToken;

