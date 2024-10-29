// api/config.js

const { getRedirectUrl } = require('./vercelUtils');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const redirectUrl = getRedirectUrl(req); 
        res.status(200).json({ redirectUrl }); 
    } catch (error) {
        console.error('Error fetching Redirect URL:', error);
        res.status(500).json({ error: 'Failed to fetch Redirect URL' });
    }
};
