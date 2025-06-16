// api/gardena.js

const axios = require('axios');
const { setKVValue, getKVValue } = require('./kvHelpers');
const { getRedirectUrl, getWebhookUrl } = require('./vercelUtils');
const { getCachedKVValue } = require('./kvCache');
const oauthHandler = require('./oauth');
const { checkAndRefreshToken } = oauthHandler;

const logMessage = (message) => {
  console.log(`${new Date().toISOString()} - ${message}`);
};

module.exports = async (req, res) => {
  try {
    const { action } = req.query;
    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      if (req.body) {
        if (typeof req.body === 'object') {
          body = req.body;
        } else {
          try {
            body = JSON.parse(req.body);
          } catch (error) {
            console.error('Error parsing JSON:', error);
            return res.status(400).json({ error: 'Invalid JSON in request body' });
          }
        }
      } else {
        body = {};
      }
    }

    switch (action) {
      case 'register-webhook': {
        const locationId = await getKVValue('gardenaLocation');
        const authToken = await getKVValue('gardenaAuthToken');
        const webhookUrl = getWebhookUrl(req);
        try {
          await registerWebhook(locationId, authToken, webhookUrl);
          await setKVValue('webhookRegistered', 'true');
          res.status(200).json({ message: 'Webhook registered successfully' });
        } catch (error) {
          console.error('Error in register-webhook:', error.message);
          await setKVValue('webhookRegistered', 'false');
          res.status(500).json({ error: `Failed to register webhook: ${error.message}` });
        }
        break;
      }

      case 'update-device-states': {
        try {
          const { events } = body;
          await updateDeviceStates(events);
          res.status(200).json({ message: 'Device states updated' });
        } catch (error) {
          console.error('Error in update-device-states:', error.message);
          res.status(500).json({ error: `Failed to update device states: ${error.message}` });
        }
        break;
      }

      case 'handle-pump-state': {
        try {
          await handlePumpState();
          res.status(200).json({ message: 'Pump state handled' });
        } catch (error) {
          console.error('Error in handle-pump-state:', error.message);
          res.status(500).json({ error: `Failed to handle pump state: ${error.message}` });
        }
        break;
      }

      case 'save-pump-and-valves': {
        const { pumpId, valves } = body;
        if (!pumpId || !valves || valves.length === 0) {
          return res.status(400).json({ error: 'Missing pumpId or valves' });
        }
        try {
          await savePumpAndValves(pumpId, valves);
          res.status(200).json({ message: 'Pump and valves saved successfully' });
        } catch (error) {
          console.error('Error in save-pump-and-valves:', error);
          res.status(500).json({ error: `Failed to save pump and valves: ${error.message}` });
        }
        break;
      }

      case 'save-credentials': {
        const { clientID, clientSecret } = body;
        if (!clientID || !clientSecret) {
          return res.status(400).json({ error: 'Missing clientID or clientSecret' });
        }
        try {
          const authUrl = await saveCredentials(clientID, clientSecret, req);
          console.log('Returning authUrl to frontend:', authUrl);
          res.status(200).json({ authUrl });
        } catch (error) {
          console.error('Error in saveCredentials:', error);
          res.status(500).json({ error: `Failed to save credentials: ${error.message}` });
        }
        break;
      }

      case 'get-pump-valves': {
        try {
          // load creds & location
          const [authToken, SMART_HOST, CLIENT_ID, locationId] = await Promise.all([
            getKVValue('gardenaAuthToken'),
            getKVValue('gardenaSmartHost'),
            getKVValue('gardenaClientId'),
            getKVValue('gardenaLocation')
          ]);

          if (!authToken || !SMART_HOST || !CLIENT_ID || !locationId) {
            throw new Error('Missing Gardena credentials or location');
          }

          // 1) Fetch v2 locations/{id} with included services
          const headers = {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/vnd.api+json',
            'X-Api-Key': CLIENT_ID
          };
          const resp = await axios.get(
            `${SMART_HOST}/v2/locations/${locationId}`,
            { headers }
          );

          if (resp.status !== 200 || !Array.isArray(resp.data.included)) {
            throw new Error('Unexpected payload from Gardena API');
          }

          const included = resp.data.included;

          // 2) Group by device ID
          const devices = {};
          included.forEach(item => {
            const did = item.relationships.device.data.id;
            if (!devices[did]) devices[did] = { id: did, services: {} };
            devices[did].services[item.type] = item;
          });

          // 3) Build pumps & valves lists
          const pumps = [];
          const valves = [];

          Object.values(devices).forEach(device => {
            const { id, services } = device;
            const common = services.COMMON;
            if (!common) return;

            const name      = common.attributes.name.value;
            const modelType = common.attributes.modelType.value;

            //— pumps are devices with a POWER_SOCKET service
            if (services.POWER_SOCKET) {
              pumps.push({ id, name });
            }

            //— valves: either Water Control or Irrigation Control
            if (modelType === 'GARDENA smart Water Control') {
              valves.push({ id, name, modelType });
            }
            else if (modelType === 'GARDENA smart Irrigation Control') {
              // sub-valves = all VALVE services on the same device
              const sub = included
                .filter(i =>
                  i.type === 'VALVE' &&
                  i.relationships.device.data.id === id
                )
                .map(i => ({
                  id:            i.id,
                  name:          i.attributes.name.value,
                  isUnavailable: i.attributes.activity.value === 'UNAVAILABLE'
                }));
              valves.push({ id, name, modelType, valves: sub });
            }
          });

          return res.status(200).json({ pumps, valves });
        }
        catch (error) {
          console.error('Error in get-pump-valves:', error);
          return res.status(500).json({ error: error.message });
        }
      }

      default:
        res.status(400).json({ error: 'Invalid action.' });
    }
  } catch (error) {
    logMessage(`Unhandled error in api/gardena: ${error.message}`);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

async function saveCredentials(clientID, clientSecret, req) {
  try {
    await setKVValue('gardenaClientId', clientID.toString());
    await setKVValue('gardenaClientSecret', clientSecret.toString());
    await setKVValue('gardenaSmartHost', 'https://api.smart.gardena.dev');
    await setKVValue('gardenaAuthHost', 'https://api.authentication.husqvarnagroup.dev');

    const redirectUrl = getRedirectUrl(req);
    const state = Math.random().toString(36).substring(2, 15);
    const authHost = await getKVValue('gardenaAuthHost');
    const scope = 'iam:read_organization sg-integration-api:read';
    const authUrl = `${authHost}/v1/oauth2/authorize?client_id=${encodeURIComponent(
      clientID
    )}&redirect_uri=${encodeURIComponent(
      redirectUrl
    )}&response_type=code&state=${state}&scope=${encodeURIComponent(scope)}`;

    return authUrl;
  } catch (error) {
    console.error('Error in saveCredentials function:', error);
    throw new Error(`Error saving credentials: ${error.message}`);
  }
}

async function registerWebhook(locationId, authToken, webhookUrl) {
  const SMART_HOST = await getKVValue('gardenaSmartHost');
  const clientId = await getKVValue('gardenaClientId');
  const currentHmacValidUntil = await getKVValue('hmacSecretValidity');

  const now = new Date();
  if (currentHmacValidUntil && new Date(currentHmacValidUntil) - now > 24 * 60 * 60 * 1000) {
    console.log('Webhook is still valid, no need to re-register');
    return;
  }

  const headers = {
    Accept: 'application/vnd.api+json',
    Authorization: `Bearer ${authToken}`,
    'x-api-key': clientId,
    'Content-Type': 'application/vnd.api+json',
  };

  const webhookPayload = {
    data: {
      type: 'WEBHOOK',
      attributes: {
        url: webhookUrl,
        locationId: locationId,
      },
      id: locationId,
    },
  };

  try {
    console.log('Registering webhook with payload:', JSON.stringify(webhookPayload, null, 2));
    const response = await axios.post(`${SMART_HOST}/v2/webhook`, webhookPayload, { headers });
    if (![200, 201].includes(response.status)) throw new Error('Failed to register webhook');

    const hmacSecret = response.data.data.attributes.hmacSecret;
    if (hmacSecret) {
      await setKVValue('gardenaHmacSecret', hmacSecret);
      console.log('HMAC secret stored successfully.');
    } else {
      console.warn('No HMAC secret returned by the API.');
    }

    const validUntilSec = response.data.data.attributes.validUntil;
    const hmacValidUntil = new Date(validUntilSec * 1000);
    await setKVValue('hmacSecretValidity', hmacValidUntil.toISOString());
    console.log(`HMAC validity stored. Webhook valid until: ${hmacValidUntil}`);
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error('Error registering webhook:', JSON.stringify(errorData, null, 2));
    throw new Error(`Error registering webhook: ${typeof errorData === 'object' ? JSON.stringify(errorData) : errorData}`);
  }
}

async function updateDeviceStates(events) {
  const valveIdsString = await getKVValue('gardenaValveIds');
  const valveIds = valveIdsString ? JSON.parse(valveIdsString) : [];
  const pumpId = await getKVValue('gardenaPumpId');
  const deviceStatesString = (await getKVValue('gardenaDeviceStates')) || '{}';
  let deviceStates = JSON.parse(deviceStatesString);

  for (const event of events) {
    const deviceId = event.id;
    const isValve = valveIds.includes(deviceId);
    const isPump = deviceId === pumpId;

    if (isValve || isPump) {
      deviceStates[deviceId] = deviceStates[deviceId] || {};

      Object.entries(event.attributes).forEach(([key, value]) => {
        deviceStates[deviceId][key] = { value: value.value, timestamp: value.timestamp };
      });
    }
  }

  await setKVValue('gardenaDeviceStates', JSON.stringify(deviceStates));
}

async function handlePumpState() {
  console.log('handlePumpState started');

  const pumpId = await getKVValue('gardenaPumpId');
  console.log(`Fetched pumpId: ${pumpId}`);

  const valveIdsString = await getKVValue('gardenaValveIds');
  const valveIds = valveIdsString ? JSON.parse(valveIdsString) : [];
  console.log(`Fetched valveIds: ${JSON.stringify(valveIds)}`);

  const deviceStatesString = (await getKVValue('gardenaDeviceStates')) || '{}';
  const deviceStates = JSON.parse(deviceStatesString);
  console.log(`Fetched deviceStates: ${JSON.stringify(deviceStates, null, 2)}`);

  const isAnyValveWatering = valveIds.some((valveId) => {
    const valve = deviceStates[valveId];
    const isWatering = valve &&
      (valve.activity?.value === 'MANUAL_WATERING' || valve.activity?.value === 'SCHEDULED_WATERING');

    console.log(`Valve ID: ${valveId}, Watering: ${isWatering}`);
    return isWatering;
  });

  const newPumpActionState = isAnyValveWatering ? 'open' : 'closed';
  console.log(`Determined new pump action state: ${newPumpActionState}`);

  console.log('Starting performPumpAction...');
  await performPumpAction(newPumpActionState);
  console.log('Completed performPumpAction...');
  console.log('handlePumpState completed');
}

async function savePumpAndValves(pumpId, valves) {
  try {
    await setKVValue('gardenaPumpId', pumpId.toString());
    await setKVValue('gardenaValveIds', JSON.stringify(valves));
  } catch (error) {
    throw new Error(`Error saving pump and valves: ${error.message}`);
  }
}

async function performPumpAction(actionState) {
  const SMART_HOST = await getKVValue('gardenaSmartHost');
  const pumpId = await getKVValue('gardenaPumpId');
  const authToken = await getKVValue('gardenaAuthToken');
  const clientId = await getKVValue('gardenaClientId');

  const headers = {
    Accept: 'application/vnd.api+json',
    Authorization: `Bearer ${authToken}`,
    'X-Api-Key': clientId,
    'Content-Type': 'application/vnd.api+json',
  };

  const data = {
    data: {
      type: 'VALVE_CONTROL',
      id: 'request-by-script',
      attributes: {
        command: actionState === 'open' ? 'START_SECONDS_TO_OVERRIDE' : 'STOP_UNTIL_NEXT_TASK',
        ...(actionState === 'open' && { seconds: 3600 }),
      },
    },
  };

  const url = `${SMART_HOST}/v1/command/${pumpId}`;
  console.log('Constructed URL:', url);
  console.log('Request Headers:', JSON.stringify(headers, null, 2));
  console.log('Request Data:', JSON.stringify(data, null, 2));

  try {
    const response = await axios.put(url, data, { headers });
    if (response.status !== 202) {
      console.error('Pump action failed with status:', response.status);
      console.error('Response data:', JSON.stringify(response.data, null, 2));
      throw new Error(`Failed to perform pump action: ${actionState}`);
    }
  } catch (error) {
    if (error.response) {
      console.error('Error response status:', error.response.status);
      console.error('Error response data:', JSON.stringify(error.response.data, null, 2));
      throw new Error(`Error performing pump action: ${JSON.stringify(error.response.data)}`);
    } else {
      console.error('Error performing pump action:', error.message);
      throw new Error(`Error performing pump action: ${error.message}`);
    }
  }
}
