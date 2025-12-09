// Create checkout session endpoint
const app = require('../stripe-server.js');

module.exports = (req, res) => {
  return app(req, res);
};
