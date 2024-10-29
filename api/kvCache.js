// api/kvCache.js

const { getKVValue } = require('./kvHelpers');
const kvCache = {};

async function getCachedKVValue(key) {
  if (kvCache.hasOwnProperty(key)) {
    return kvCache[key];
  }
  const value = await getKVValue(key);
  kvCache[key] = value;
  return value;
}

module.exports = {
  getCachedKVValue,
};
