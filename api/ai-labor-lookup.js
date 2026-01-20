/**
 * Vercel Serverless Function: AI Labor Lookup
 * Path: /api/ai-labor-lookup
 */
const app = require('../stripe-server.js');

module.exports = (req, res) => {
  // Delegate to the main Express app so Vercel's serverless wrapper uses the same routes
  return app(req, res);
};
