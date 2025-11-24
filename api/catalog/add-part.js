import { addPartToJob } from '../../helpers/catalog-api';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  try {
    const { jobId, partId, quantity, costPrice, sellPrice, shopId } = req.body;
    const result = await addPartToJob({ jobId, partId, quantity, costPrice, sellPrice, shopId });
    res.status(200).json(result);
  } catch (err) {
    console.error('❌ Add part error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
