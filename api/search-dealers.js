/**
 * Vercel Serverless Function: Search Dealers
 * Path: /api/search-dealers
 * 
 * This is a pass-through to the Express app handler
 */

const app = require('../stripe-server.js');

module.exports = (req, res) => {
  // Pass through to express app
  return app(req, res);
};
