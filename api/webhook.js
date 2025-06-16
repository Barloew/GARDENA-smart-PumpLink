// api/webhook.js

const crypto = require('crypto');
const { getKVValue } = require('./kvHelpers');
const { updateDeviceStates, handlePumpState } = require('./gardena');
const { getCachedKVValue } = require('./kvCache');
const oauthHandler = require('./oauth');
const { checkAndRefreshToken } = oauthHandler;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let rawBody = '';
  req.on('data', (chunk) => {
    rawBody += chunk;
  });

  req.on('end', async () => {
    try {
      // Temporarily disabling HMAC validation for debugging
      // const signature = req.headers['x-authorization-content-sha256'];
      // if (!signature) {
      //   return res.status(400).send('Missing signature header');
      // }

      // const hmacSecret = await getCachedKVValue('gardenaHmacSecret');
      // if (!hmacSecret) {
      //   console.error('HMAC secret not found in KV cache');
      //   return res.status(500).send('Internal server error');
      // }

      // const isValid = validateHmacSignature(rawBody, hmacSecret, signature);
      // if (!isValid) {
      //   return res.status(400).send('Invalid HMAC signature');
      // }

      // Token refresh
      try {
        await checkAndRefreshToken();
        console.log('Access token checked and refreshed if needed');
      } catch (error) {
        console.error('Error checking and refreshing token:', error);
        return res.status(500).send('Error refreshing access token');
      }

      let parsedBody;
      try {
        parsedBody = JSON.parse(rawBody);
        console.log('Parsed body:', JSON.stringify(parsedBody, null, 2));
      } catch (error) {
        console.error('Error parsing JSON body:', error);
        return res.status(400).send('Error parsing JSON body');
      }

      if (
        parsedBody.data &&
        parsedBody.data.attributes &&
        Array.isArray(parsedBody.data.attributes.events)
      ) {
        const events = parsedBody.data.attributes.events;
        console.log('Events:', JSON.stringify(events, null, 2));

        const relevantModelTypes = [
          'GARDENA smart Irrigation Control',
          'GARDENA smart Water Control',
        ];

        const hasRelevantModelType = events.some((event) => {
          if (event.type === 'COMMON') {
            const modelType = event.attributes?.modelType?.value;
            return relevantModelTypes.includes(modelType);
          }
          return false;
        });

        if (!hasRelevantModelType) {
          console.log('No relevant modelType found in events. Dropping event.');
          return res.status(200).send('Event ignored due to irrelevant modelType.');
        }

        try {
          console.log('Starting updateDeviceStates...');
          await updateDeviceStates(events);
          console.log('Completed updateDeviceStates.');
          console.log('Starting handlePumpState...');
          await handlePumpState();
          console.log('Completed handlePumpState.');
          res.status(200).send('Event received and processed');
        } catch (error) {
          console.error('Error processing events:', error);
          res.status(500).send('Error processing events');
        }
      } else {
        res.status(400).send('Invalid event data');
      }
    } catch (error) {
      console.error('Error in webhook handler:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
};

// HMAC validation helper (unchanged, but not used during debugging)
function validateHmacSignature(rawBody, secret, signature) {
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return computedSignature === signature;
}
