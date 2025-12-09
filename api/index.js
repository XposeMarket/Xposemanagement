// Vercel Serverless Function Handler
// This wraps the Express app for Vercel's serverless environment

const serverless = require('serverless-http');
const app = require('../stripe-server.js');

// Wrap Express app with serverless-http for Vercel
module.exports = serverless(app);
