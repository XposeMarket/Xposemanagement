// Health check endpoint
const app = require('../stripe-server.js');

module.exports = (req, res) => {
  // Pass through to express app
  return app(req, res);
};
