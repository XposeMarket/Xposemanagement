/**
 * Twilio Incoming SMS Webhook
 * Handles incoming messages from Twilio and saves them to Supabase
 */

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      MessageSid,
      From,
      To,
      Body,
      NumMedia,
      MediaUrl0,
      MediaContentType0
    } = req.body;

    console.log('📨 Incoming Twilio message from:', From, 'to:', To);

    // Find the shop that owns this Twilio number
    const { data: twilioNumber, error: numberError } = await supabase
      .from('shop_twilio_numbers')
      .select('id, shop_id')
      .eq('phone_number', To)
      .single();

    if (numberError || !twilioNumber) {
      console.error('❌ Twilio number not found:', To, numberError);
      // Still return 200 to Twilio so it doesn't retry
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    const shopId = twilioNumber.shop_id;

    // Find or create thread for this conversation
    let thread;
    const { data: existingThread } = await supabase
      .from('threads')
      .select('*')
      .eq('shop_id', shopId)
      .eq('external_recipient', From)
      .eq('archived', false)
      .maybeSingle();

    if (existingThread) {
      thread = existingThread;
      
      // Update thread's last_message_at
      await supabase
        .from('threads')
        .update({
          last_message: Body?.substring(0, 100) || 'Media message',
          last_message_at: new Date().toISOString()
        })
        .eq('id', existingThread.id);
        
    } else {
      // Create new thread
      const { data: newThread, error: threadError } = await supabase
        .from('threads')
        .insert({
          shop_id: shopId,
          external_recipient: From,
          twilio_number_id: twilioNumber.id,
          last_message: Body?.substring(0, 100) || 'Media message',
          last_message_at: new Date().toISOString()
        })
        .select()
        .single();

      if (threadError) {
        console.error('❌ Error creating thread:', threadError);
        return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      thread = newThread;
    }

    // Handle media attachments
    const media = [];
    if (NumMedia && parseInt(NumMedia) > 0) {
      for (let i = 0; i < parseInt(NumMedia); i++) {
        const mediaUrl = req.body[`MediaUrl${i}`];
        const contentType = req.body[`MediaContentType${i}`];
        if (mediaUrl) {
          media.push({ url: mediaUrl, contentType });
        }
      }
    }

    // Save message to database
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        thread_id: thread.id,
        twilio_message_id: MessageSid,
        from_number: From,
        to_number: To,
        body: Body || '',
        direction: 'inbound',
        status: 'received',
        media: media.length > 0 ? media : null
      })
      .select()
      .single();

    if (messageError) {
      console.error('❌ Error saving message:', messageError);
    } else {
      console.log('✅ Message saved:', message.id);
    }

    // Respond to Twilio with empty TwiML
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  } catch (error) {
    console.error('❌ Webhook error:', error);
    // Always return 200 to Twilio to prevent retries
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
}
