/**
 * Twilio Incoming SMS Webhook
 * Handles incoming messages from Twilio and saves them to Supabase
 */

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  // Log everything for debugging
  console.log('🔔 Webhook called!', {
    method: req.method,
    body: req.body,
    headers: req.headers
  });

  // Only accept POST requests
  if (req.method !== 'POST') {
    console.log('❌ Wrong method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('🔑 Supabase config:', {
      hasUrl: !!supabaseUrl,
      hasKey: !!supabaseKey,
      url: supabaseUrl
    });

    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ Missing Supabase credentials');
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      MessageSid,
      From,
      To,
      Body,
      NumMedia
    } = req.body;

    console.log('📨 Incoming message:', { MessageSid, From, To, Body, NumMedia });

    // Find the shop that owns this Twilio number
    const { data: twilioNumber, error: numberError } = await supabase
      .from('shop_twilio_numbers')
      .select('id, shop_id')
      .eq('phone_number', To)
      .single();

    console.log('📱 Found Twilio number:', { twilioNumber, numberError });

    if (numberError || !twilioNumber) {
      console.error('❌ Twilio number not found:', To, numberError);
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    const shopId = twilioNumber.shop_id;

    // Find or create thread for this conversation
    let thread;
    const { data: existingThread, error: threadFindError } = await supabase
      .from('threads')
      .select('*')
      .eq('shop_id', shopId)
      .eq('external_recipient', From)
      .eq('archived', false)
      .maybeSingle();

    console.log('🔍 Thread search:', { existingThread, threadFindError });

    if (existingThread) {
      thread = existingThread;
      
      // Update thread's last_message_at
      const { error: updateError } = await supabase
        .from('threads')
        .update({
          last_message: Body?.substring(0, 100) || 'Media message',
          last_message_at: new Date().toISOString()
        })
        .eq('id', existingThread.id);

      console.log('📝 Updated thread:', updateError);
        
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

      console.log('➕ Created thread:', { newThread, threadError });

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

    console.log('💾 Message save result:', { message, messageError });

    if (messageError) {
      console.error('❌ Error saving message:', messageError);
    } else {
      console.log('✅ Message saved successfully:', message.id);
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
};
