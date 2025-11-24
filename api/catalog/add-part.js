import { addPartToJob } from '../../helpers/catalog-api';

export default async function handler(req, res) {
  console.log('[add-part.js] Handler called. Method:', req.method);
  if (req.method !== 'POST') {
    console.log('[add-part.js] 405 Not Allowed. Method:', req.method);
    res.status(405).send('Method Not Allowed');
    return;
  }
  try {
    const { jobId, partId, quantity, costPrice, sellPrice, shopId } = req.body;
    console.log('[add-part.js] POST payload:', req.body);
    const result = await addPartToJob({ jobId, partId, quantity, costPrice, sellPrice, shopId });
    res.status(200).json(result);
  } catch (err) {
    console.error('[add-part.js] ❌ Add part error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
