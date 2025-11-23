/* server-grok-only.js
 * Prototype Grok-only parts search server.
 * - Configurable via env: XAI_API_URL, XAI_API_KEY, XAI_MODEL
 * - POST /search-parts { year, make, model, part }
 * - Calls the chat completions endpoint and attempts to extract a JSON array
 *   from the assistant's message content. Returns { mode, items, raw }
 *
 * NOTE: No API keys are included. Fill them in a local .env or env vars
 */

import express from 'express';
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const XAI_API_URL = process.env.XAI_API_URL || 'https://api.x.ai/v1/chat/completions';
const XAI_API_KEY = process.env.XAI_API_KEY || '';
const XAI_MODEL = process.env.XAI_MODEL || 'grok-4-fast-reasoning';
const PORT = process.env.PORT || 3000;

// Helpful startup diagnostics (masked key)
function maskKey(key) {
  if (!key) return '(none)';
  if (key.length <= 10) return key;
  return key.slice(0,6) + '...' + key.slice(-4);
}
console.log('cwd:', process.cwd());
console.log('PORT:', PORT);
console.log('XAI_API_URL:', XAI_API_URL);
console.log('XAI_API_KEY:', maskKey(XAI_API_KEY));
console.log('XAI_API_MODEL:', XAI_MODEL);

function validateBody(b){
  return b && b.year && b.make && b.model && b.part;
}

function extractJsonArray(text){
  if (!text || typeof text !== 'string') return null;
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch(e) { /* fallthrough */ }
  }
  // fallback: look for multiple objects and wrap in array
  const objMatches = text.match(/\{[\s\S]*?\}/g);
  if (objMatches && objMatches.length) {
    try {
      const objs = objMatches.map(s => JSON.parse(s));
      return objs;
    } catch(e) { return null; }
  }
  return null;
}

async function callGrokChatPrompt(query){
  const payload = {
    model: XAI_MODEL,
    messages: [
      { role: 'system', content: 'You are a web research assistant with access to browsing tools when available. Respond with a JSON array only when asked.' },
      { role: 'user', content: `Search for "${query}" and return the top 3 results as a JSON array. Each item must be: {title, url, snippet, estimated_price (string|null), part_number (string|null), source_domain, confidence (0-1)}. RETURN ONLY THE JSON ARRAY.` }
    ],
    max_tokens: 800
  };

  const headers = {
    'Content-Type': 'application/json'
  };
  if (XAI_API_KEY) headers['Authorization'] = `Bearer ${XAI_API_KEY}`;

  const resp = await axios.post(XAI_API_URL, payload, { headers, timeout: 60000 });
  return resp.data;
}

app.post('/search-parts', async (req, res) => {
  try {
    if (!validateBody(req.body)) return res.status(400).json({ error: 'Provide year, make, model, part' });
    const { year, make, model, part } = req.body;
    const userQuery = `${year} ${make} ${model} ${part}`;

    // call the chat endpoint
    const raw = await callGrokChatPrompt(userQuery);

    // Many providers place assistant text at choices[0].message.content
    let assistantText = null;
    if (raw && raw.choices && raw.choices[0] && raw.choices[0].message) {
      assistantText = raw.choices[0].message.content;
    } else if (raw && raw.output) {
      // fallback shapes
      assistantText = typeof raw.output === 'string' ? raw.output : JSON.stringify(raw.output);
    } else {
      assistantText = JSON.stringify(raw);
    }

    // attempt to extract JSON array
    const parsed = extractJsonArray(assistantText);

    if (parsed && parsed.length) {
      // return top 3 items
      return res.json({ mode: 'grok-chat', items: parsed.slice(0,3), raw: assistantText });
    }

    // not parseable — return raw to help debugging
    return res.status(502).json({ error: 'Model did not return parseable JSON array. See raw output.', raw: assistantText, full_response: raw });
  } catch (err) {
    console.error('search-parts error:', err && err.message);
    const details = err && err.response && err.response.data ? err.response.data : err.message || String(err);
    res.status(500).json({ error: 'Internal', details });
  }
});

// Serve static files from the project root so parts-test.html can be opened at
// http://localhost:PORT/parts-test.html
app.use(express.static(process.cwd()));

app.get('/', (req, res) => {
  res.send('Grok-only parts search prototype is running. POST /search-parts');
});

const server = app.listen(PORT, () => console.log(`Grok-only parts search listening on ${PORT}. Static root: ${process.cwd()}`));

server.on('error', (err) => {
  console.error('Server error:', err && err.code ? err.code : err);
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try a different PORT or stop the process using it.`);
  }
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
