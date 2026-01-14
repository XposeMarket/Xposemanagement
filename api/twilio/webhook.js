/**
 * Twilio Incoming SMS Webhook (serverless)
 * Downloads any Twilio-hosted media, uploads to Supabase `messages-media` bucket,
 * and saves message rows with Supabase URLs so clients can load attachments.
 */

const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { createShopNotification } = require('../../lib/shop-notifications.js');

module.exports = async function handler(req, res) {
  console.log('🔔 Twilio webhook (serverless) called', { method: req.method });
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  try {
    const { From, To, Body, MessageSid, NumMedia } = req.body || {};

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase not configured');
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find shop and thread
    const normalizedTo = To ? To.toString().replace(/[^+\d]/g, '') : To;
    const { data: shopNumbers } = await supabase
      .from('shop_twilio_numbers')
      .select('*')
      .eq('phone_number', normalizedTo)
      .limit(1);

    if (!shopNumbers || shopNumbers.length === 0) {
      console.error('No shop found for Twilio number:', normalizedTo);
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    const shopNumber = shopNumbers[0];

    // Find or create thread (simple lookup)
    const normalizedFrom = From ? From.toString().replace(/[^+\d]/g, '') : From;
    let thread = null;
    const { data: threads } = await supabase
      .from('threads')
      .select('*')
      .eq('shop_id', shopNumber.shop_id)
      .eq('external_recipient', normalizedFrom)
      .limit(1);
    if (threads && threads.length) thread = threads[0];
    else {
      const { data: newThread } = await supabase
        .from('threads')
        .insert([{ shop_id: shopNumber.shop_id, external_recipient: normalizedFrom, last_message_at: new Date().toISOString() }])
        .select()
        .single();
      thread = newThread;
    }

    // Process media: download Twilio media and upload to Supabase
    let media = [];
    const mediaCount = parseInt(NumMedia || '0', 10);
    const bucket = process.env.SUPABASE_MEDIA_BUCKET || 'messages-media';
    for (let i = 0; i < mediaCount; i++) {
      const mediaUrl = req.body[`MediaUrl${i}`];
      const contentType = req.body[`MediaContentType${i}`] || null;
      if (!mediaUrl) continue;
      try {
        const twilioSid = process.env.TWILIO_ACCOUNT_SID;
        const twilioToken = process.env.TWILIO_AUTH_TOKEN;
        const resp = await axios.get(mediaUrl, {
          responseType: 'arraybuffer',
          auth: twilioSid && twilioToken ? { username: twilioSid, password: twilioToken } : undefined,
          validateStatus: s => s >= 200 && s < 400
        });
        const buffer = Buffer.from(resp.data);

        // Choose extension
        let ext = 'bin';
        if (contentType) {
          if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
          else if (contentType.includes('png')) ext = 'png';
          else if (contentType.includes('gif')) ext = 'gif';
          else if (contentType.includes('webp')) ext = 'webp';
          else if (contentType.includes('mp4')) ext = 'mp4';
        }

        const path = `${shopNumber.shop_id}/inbound/${Date.now()}_${i}.${ext}`;
        const { data: up, error: upErr } = await supabase.storage.from(bucket).upload(path, buffer, { contentType, upsert: false });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
        const publicUrl = urlData?.publicUrl || mediaUrl;
        media.push({ url: publicUrl, contentType });
      } catch (e) {
        console.error('Error processing incoming media:', e && e.message ? e.message : e);
        media.push({ url: mediaUrl, contentType });
      }
    }

    // Save message record
    const { data: message, error: messageError } = await supabase.from('messages').insert([{ 
      thread_id: thread.id,
      twilio_message_id: MessageSid,
      from_number: From,
      to_number: To,
      body: Body || '',
      direction: 'inbound',
      status: 'received',
      media: media.length ? media : null,
      num_media: mediaCount
    }]).select().single();

    if (messageError) console.error('Error saving incoming message:', messageError);

    // Respond to Twilio
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
};
