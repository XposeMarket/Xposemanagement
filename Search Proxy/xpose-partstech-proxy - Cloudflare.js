// xpose-partstech-proxy - Cloudflare Worker
// POST /search  { vehicle: "VIN|plate|YMM", query: "brake pads" }

const ALLOW_ORIGIN = "*"; // For dev. Later set "https://<your-domain>" for production.

export default {
  async fetch(req, env, ctx) {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOW_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (new URL(req.url).pathname !== "/search")
      return json({ error: "Not Found" }, 404);

    if (req.method !== "POST")
      return json({ error: "Method Not Allowed" }, 405);

    let body;
    try { body = await req.json(); }
    catch { return json({ error: "Bad JSON" }, 400); }

    const vehicle = (body.vehicle || "").trim();
    const query   = (body.query   || "").trim();

    // Safety: require some input
    if (!query) return json({ results: [], note: "Missing query" });

    // DEV MOCK: If you haven’t set real creds yet, flip PT_MOCK=1 in env to return fake data.
    if (env.PT_MOCK === "1") {
      return json({
        results: [
          { id: "MOCK-1", name: `${query}`,           brand: "GenericCo", price: 49.95 },
          { id: "MOCK-2", name: `${query} premium`,   brand: "ProLine",   price: 79.50 },
          { id: "MOCK-3", name: `${query} ceramic`,   brand: "CeramiX",   price: 99.00 },
        ]
      });
    }

    // === REAL PARTSTECH CALL ===
    // Store your real creds in Worker "Secrets":
    //   PARTSTECH_USERNAME, PARTSTECH_API_KEY
    // Your PartsTech rep will confirm the exact endpoint + headers.
    const USERNAME = env.PARTSTECH_USERNAME;
    const API_KEY  = env.PARTSTECH_API_KEY;

    if (!USERNAME || !API_KEY) {
      return json({ results: [], error: "Missing server credentials" }, 500);
    }

    try {
      // Example shape; customize per PartsTech docs from your rep:
      const upstream = await fetch("https://api.partstech.com/catalog/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Many SMS partners use username + api key headers (your rep will confirm exact names):
          "X-PT-Username": USERNAME,
          "X-PT-Api-Key": API_KEY
        },
        body: JSON.stringify({
          keyword: query,
          vehicle,        // VIN/plate/YMM strongly recommended for accurate fitment
          page: 1,
          per_page: 15
        })
      });

      if (!upstream.ok) {
        const txt = await upstream.text();
        return json({ results: [], error: `Upstream ${upstream.status}: ${txt}` }, upstream.status);
      }

      const data = await upstream.json();

      // Normalize to your UI’s expected fields
      const results = (data.results || []).map(p => ({
        id:    p.part_number || p.id || p.sku || cryptoRandom(),
        name:  p.part_name || p.description || p.title || "",
        brand: p.brand_name || p.brand || "",
        price: Number(p.price || p.unit_price || 0)
      }));

      return json({ results });
    } catch (e) {
      return json({ results: [], error: String(e) }, 502);
    }
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOW_ORIGIN
    }
  });
}
function cryptoRandom() { return "id_" + Math.random().toString(36).slice(2); }
