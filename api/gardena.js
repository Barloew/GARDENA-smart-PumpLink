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
    if (['POST', 'PUT'].includes(req.method) && req.body) {
      body = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
    }

    switch (action) {
      case 'register-webhook': {
        const locationId = await getCachedKVValue('gardenaLocation');
        const authToken = await getCachedKVValue('gardenaAuthToken');
        const webhookUrl = getWebhookUrl(req);
        try {
          await registerWebhook(locationId, authToken, webhookUrl);
          await setKVValue('webhookRegistered', 'true');
          return res.status(200).json({ message: 'Webhook registered successfully' });
        } catch (error) {
          console.error('Error in register-webhook:', error.message);
          await setKVValue('webhookRegistered', 'false');
          return res.status(500).json({ error: `Failed to register webhook: ${error.message}` });
        }
      }

      case 'update-device-states': {
        try {
          await updateDeviceStates(body.events || []);
          return res.status(200).json({ message: 'Device states updated' });
        } catch (error) {
          console.error('Error in update-device-states:', error.message);
          return res.status(500).json({ error: `Failed to update device states: ${error.message}` });
        }
      }

      case 'handle-pump-state': {
        try {
          await handlePumpState();
          return res.status(200).json({ message: 'Pump state handled' });
        } catch (error) {
          console.error('Error in handle-pump-state:', error.message);
          return res.status(500).json({ error: `Failed to handle pump state: ${error.message}` });
        }
      }

      case 'save-pump-and-valves': {
        const { pumpId, valves } = body;
        if (!pumpId || !Array.isArray(valves) || valves.length === 0) {
          return res.status(400).json({ error: 'Missing pumpId or valves' });
        }
        try {
          await savePumpAndValves(pumpId, valves);
          return res.status(200).json({ message: 'Pump and valves saved successfully' });
        } catch (error) {
          console.error('Error in save-pump-and-valves:', error.message);
          return res.status(500).json({ error: `Failed to save pump and valves: ${error.message}` });
        }
      }

      case 'save-credentials': {
        const { clientID, clientSecret } = body;
        if (!clientID || !clientSecret) {
          return res.status(400).json({ error: 'Missing clientID or clientSecret' });
        }
        try {
          const authUrl = await saveCredentials(clientID, clientSecret, req);
          return res.status(200).json({ authUrl });
        } catch (error) {
          console.error('Error in saveCredentials:', error.message);
          return res.status(500).json({ error: `Failed to save credentials: ${error.message}` });
        }
      }

      case 'get-pump-valves': {
        try {
          // fetch live devices and services via v2
          const [authToken, SMART_HOST, CLIENT_ID, locationId] = await Promise.all([
            getKVValue('gardenaAuthToken'),
            getKvValue('gardenaSmartHost'),
            getKVValue('gardenaClientId'),
            getKVValue('gardenaLocation')
          ]);
          if (!authToken || !SMART_HOST || !CLIENT_ID || !locationId) {
            throw new Error('Missing Gardena credentials or location');
          }

          const headers = {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/vnd.api+json',
            'X-Api-Key': CLIENT_ID
          };
          // fetch devices with included services
          const resp = await axios.get(
            `${SMART_HOST}/v2/locations/${locationId}/devices?include=services`,
            { headers }
          );
          const included = Array.isArray(resp.data.included) ? resp.data.included : [];

          // group services by device
          const devices = {};
          included.forEach(item => {
            const did = item.relationships?.device?.data?.id;
            if (!did) return;
            devices[did] = devices[did] || { id: did, services: {} };
            devices[did].services[item.type] = item;
          });

          const pumps = [];
          const valves = [];
          // build lists
          Object.values(devices).forEach(device => {
            const { id, services } = device;
            const common = services.COMMON;
            if (!common) return;
            const name = common.attributes.name.value;
            const modelType = common.attributes.modelType.value;
            // pump detection: VALVE service and modelType contains pump
            if (services.VALVE && /pump/i.test(modelType)) {
              pumps.push({ id, name });
            }
            // simple valves
            if (modelType === 'GARDENA smart Water Control') {
              valves.push({ id, name, modelType });
            } else if (modelType === 'GARDENA smart Irrigation Control') {
              const sub = included
                .filter(i => i.type === 'VALVE' && i.relationships.device.data.id === id && !/pump/i.test(modelType))
                .map(i => ({ id: i.id, name: i.attributes.name.value, isUnavailable: i.attributes.activity?.value === 'UNAVAILABLE' }));
              valves.push({ id, name, modelType, valves: sub });
            }
          });
          return res.status(200).json({ pumps, valves });
        } catch (error) {
          console.error('Error in get-pump-valves:', error.message);
          return res.status(500).json({ error: error.message });
        }
      }

      default:
        return res.status(400).json({ error: 'Invalid action.' });
    }
  } catch (error) {
    logMessage(`Unhandled error in api/gardena: ${error.message}`);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

// helper functions unchanged below
async function saveCredentials(clientID, clientSecret, req) {
  await setKVValue('gardenaClientId', clientID.toString());
  await setKVValue('gardenaClientSecret', clientSecret.toString());
  await setKVValue('gardenaSmartHost', 'https://api.smart.gardena.dev');
  await setKVValue('gardenaAuthHost', 'https://api.authentication.husqvarnagroup.dev');
  const redirectUrl = getRedirectUrl(req);
  const state = Math.random().toString(36).substring(2, 15);
  const authHost = await getCachedKVValue('gardenaAuthHost');
  const scope = 'iam:read_organization sg-integration-api:read';
  return `${authHost}/v1/oauth2/authorize?client_id=${encodeURIComponent(clientID)}&redirect_uri=${encodeURIComponent(redirectUrl)}&response_type=code&state=${state}&scope=${encodeURIComponent(scope)}`;
}

async function registerWebhook(locationId, authToken, webhookUrl) {
  const SMART_HOST = await getCachedKVValue('gardenaSmartHost');
  const clientId = await getCachedKVValue('gardenaClientId');
  const currentHmacValidUntil = await getCachedKVValue('hmacSecretValidity');
  if (currentHmacValidUntil && new Date(currentHmacValidUntil) - new Date() > 24*60*60*1000) return;
  const headers = { Accept: 'application/vnd.api+json', Authorization: `Bearer ${authToken}`, 'x-api-key': clientId, 'Content-Type': 'application/vnd.api+json' };
  const payload = { data: { type: 'WEBHOOK', id: locationId, attributes: { url: webhookUrl, locationId } } };
  const response = await axios.post(`${SMART_HOST}/v2/webhook`, payload, { headers });
  if (![200,201].includes(response.status)) throw new Error('Failed to register webhook');
  const attr = response.data.data.attributes;
  if (attr.hmacSecret) await setKVValue('gardenaHmacSecret', attr.hmacSecret);
  await setKVValue('hmacSecretValidity', new Date(attr.validUntil*1000).toISOString());
}

async function updateDeviceStates(events) {
  const valveIds = JSON.parse((await getCachedKVValue('gardenaValveIds'))||'[]');
  const pumpId = await getCachedKVValue('gardenaPumpId');
  const states = JSON.parse((await getKVValue('gardenaDeviceStates'))||'{}');
  events.forEach(({id, attributes}) => {
    if ([...valveIds, pumpId].includes(id)) {
      states[id] = states[id]||{};
      Object.entries(attributes).forEach(([k,v])=>states[id][k]={value:v.value,timestamp:v.timestamp});
    }
  });
  await setKVValue('gardenaDeviceStates', JSON.stringify(states));
}

async function handlePumpState() {
  const pumpId = await getCachedKVValue('gardenaPumpId');
  const valveIds = JSON.parse((await getCachedKVValue('gardenaValveIds'))||'[]');
  const states = JSON.parse((await getKVValue('gardenaDeviceStates'))||'{}');
  const isWatering = valveIds.some(id=>{
    const act=states[id]?.activity?.value;
    return act==='MANUAL_WATERING'||act==='SCHEDULED_WATERING';
  });
  await performPumpAction(isWatering?'open':'closed');
}

async function savePumpAndValves(pumpId, valves) {
  await setKVValue('gardenaPumpId', pumpId.toString());
  await setKVValue('gardenaValveIds', JSON.stringify(valves));
}

async function performPumpAction(actionState) {
  const SMART_HOST = await getCachedKVValue('gardenaSmartHost');
  const pumpId = await getCachedKVValue('gardenaPumpId');
  const authToken=await getCachedKVValue('gardenaAuthToken');
  const clientId=await getCachedKVValue('gardenaClientId');
  const headers={Accept:'application/vnd.api+json',Authorization:`Bearer ${authToken}`,'X-Api-Key':clientId,'Content-Type':'application/vnd.api+json'};
  const data={data:{type:'VALVE_CONTROL',id:'request-by-script',attributes:{command:actionState==='open'?'START_SECONDS_TO_OVERRIDE':'STOP_UNTIL_NEXT_TASK',...(actionState==='open'&&{seconds:3600})}}};
  const response=await axios.put(`${SMART_HOST}/v1/command/${pumpId}`,data,{headers});
  if(response.status!==202) throw new Error(`Pump action failed: ${response.status}`);
}

module.exports.updateDeviceStates = updateDeviceStates;
module.exports.handlePumpState = handlePumpState;
