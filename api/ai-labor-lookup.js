/**
 * Vercel Serverless Function: AI Labor Lookup
 * Path: /api/ai-labor-lookup
 * 
 * This is a pass-through to the Express app handler
 */

const app = require('../stripe-server.js');

module.exports = (req, res) => {
  // Pass through to express app
  return app(req, res);
};
