/**
 * Twilio Messaging Backend for Xpose Management (CommonJS version for Stripe Server)
 * Handles provisioning, sending, receiving, and status callbacks
 */

const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const APP_BASE_URL = process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'https://www.xpose.management';

// Lazy-load Twilio client
let _twilioClient = null;
function getTwilioClient() {
  if (_twilioClient) return _twilioClient;
  
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!twilioAccountSid || !twilioAuthToken) {
    throw new Error('Missing Twilio credentials: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN required');
  }
  
  _twilioClient = twilio(twilioAccountSid, twilioAuthToken);
  return _twilioClient;
}

// Lazy-load Supabase client
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY || process.env.SUPABASE_SERVICE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }
  
  _supabase = createClient(supabaseUrl, supabaseServiceKey);
  return _supabase;
}

/**
 * Normalize phone number to E.164 format
 */
function normalizePhone(phone, defaultCountry = 'US') {
  if (!phone) return null;
  
  let digits = phone.replace(/\D/g, '');
  
  if (digits.length === 11 && digits[0] === '1') {
    return '+' + digits;
  }
  
  if (digits.length === 10 && defaultCountry === 'US') {
    return '+1' + digits;
  }
  
  if (phone.startsWith('+')) {
    return '+' + digits;
  }
  
  return '+' + digits;
}

/**
 * Find or create a thread for a shop + customer conversation
 */
async function findOrCreateThread(shopId, customerId, customerPhone, twilioNumberId) {
  const supabase = getSupabase();
  const normalizedPhone = normalizePhone(customerPhone);
  
  // Try to find existing thread
  const { data: existingThreads, error: fetchError } = await supabase
    .from('threads')
    .select('*')
    .eq('shop_id', shopId)
    .eq('external_recipient', normalizedPhone)
    .eq('twilio_number_id', twilioNumberId)
    .eq('archived', false)
    .limit(1);
  
  if (fetchError) throw fetchError;
  
  if (existingThreads && existingThreads.length > 0) {
    return existingThreads[0];
  }
  
  // Create new thread
  const { data: newThread, error: createError } = await supabase
    .from('threads')
    .insert([{
      shop_id: shopId,
      customer_id: customerId,
      twilio_number_id: twilioNumberId,
      external_recipient: normalizedPhone,
      subject: null,
      last_message: null,
      last_message_at: new Date().toISOString()
    }])
    .select()
    .single();
  
  if (createError) throw createError;
  
  return newThread;
}

/**
 * POST /api/messaging/provision
 * Provision a new Twilio phone number for a shop
 */
async function provisionNumber(req, res) {
  try {
    const { shop_id: shopId, area_code: areaCode, country = 'US' } = req.body;
    
    if (!shopId) {
      return res.status(400).json({ error: 'shop_id is required' });
    }
    
    const supabase = getSupabase();
    
    // Check if shop already has an active number
    const { data: existingNumbers } = await supabase
      .from('shop_twilio_numbers')
      .select('*')
      .eq('shop_id', shopId)
      .eq('provisioning_status', 'active')
      .limit(1);
    
    if (existingNumbers && existingNumbers.length > 0) {
      return res.json({
        success: true,
        number: existingNumbers[0],
        message: 'Shop already has an active number'
      });
    }
    
    // Search for available numbers
    const searchParams = { limit: 5 };
    if (areaCode) {
      searchParams.areaCode = areaCode;
    }
    
    const availableNumbers = await getTwilioClient()
      .availablePhoneNumbers(country)
      .local
      .list(searchParams);
    
    if (!availableNumbers || availableNumbers.length === 0) {
      return res.status(404).json({ error: 'No available phone numbers found' });
    }
    
    const selectedNumber = availableNumbers[0];
    
    // Purchase the number
    const purchasedNumber = await getTwilioClient().incomingPhoneNumbers.create({
      phoneNumber: selectedNumber.phoneNumber,
      smsUrl: `${APP_BASE_URL}/api/messaging/webhook`,
      smsMethod: 'POST',
      statusCallback: `${APP_BASE_URL}/api/messaging/status`,
      statusCallbackMethod: 'POST'
    });
    
    // Save to database
    const { data: savedNumber, error: saveError } = await supabase
      .from('shop_twilio_numbers')
      .insert([{
        shop_id: shopId,
        phone_number: purchasedNumber.phoneNumber,
        twilio_sid: purchasedNumber.sid,
        country: country,
        capabilities: {
          sms: selectedNumber.capabilities.sms,
          mms: selectedNumber.capabilities.mms,
          voice: selectedNumber.capabilities.voice
        },
        provisioning_status: 'active',
        monthly_cost: 5.00,
        twilio_monthly_cost: 1.00
      }])
      .select()
      .single();
    
    if (saveError) {
      console.error('Error saving number to DB:', saveError);
      try {
        await getTwilioClient().incomingPhoneNumbers(purchasedNumber.sid).remove();
      } catch (releaseError) {
        console.error('Error releasing number after DB save failure:', releaseError);
      }
      return res.status(500).json({ error: 'Failed to save number to database' });
    }
    
    return res.json({
      success: true,
      number: savedNumber
    });
    
  } catch (error) {
    console.error('Error provisioning number:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * POST /api/messaging/send
 * Send an outbound message
 */
async function sendMessage(req, res) {
  try {
    const { shop_id: shopId, customer_id: customerId, to, body, media } = req.body;
    
    if (!shopId || !to || !body) {
      return res.status(400).json({ error: 'shop_id, to, and body are required' });
    }
    
    const supabase = getSupabase();
    const normalizedTo = normalizePhone(to);
    
    // Get shop's Twilio number
    const { data: shopNumbers, error: numberError } = await supabase
      .from('shop_twilio_numbers')
      .select('*')
      .eq('shop_id', shopId)
      .eq('provisioning_status', 'active')
      .limit(1);
    
    if (numberError || !shopNumbers || shopNumbers.length === 0) {
      return res.status(404).json({ error: 'No active Twilio number found for this shop' });
    }
    
    const shopNumber = shopNumbers[0];
    
    // Find or create thread
    const thread = await findOrCreateThread(shopId, customerId, normalizedTo, shopNumber.id);
    
    // Send via Twilio
    const messageParams = {
      from: shopNumber.phone_number,
      to: normalizedTo,
      body: body
    };
    
    if (media && media.length > 0) {
      messageParams.mediaUrl = Array.isArray(media) ? media : [media];
    }
    
    const twilioMessage = await getTwilioClient().messages.create(messageParams);
    
    // Save to database
    const { data: savedMessage, error: saveError} = await supabase
      .from('messages')
      .insert([{
        thread_id: thread.id,
        shop_id: shopId,
        customer_id: customerId,
        twilio_message_sid: twilioMessage.sid,
        direction: 'outbound',
        from_number: shopNumber.phone_number,
        to_number: normalizedTo,
        body: body,
        media: media ? (Array.isArray(media) ? media.map(url => ({ url })) : [{ url: media }]) : null,
        status: twilioMessage.status,
        num_segments: twilioMessage.numSegments || 1,
        num_media: twilioMessage.numMedia || 0,
        sent_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (saveError) {
      console.error('Error saving message to DB:', saveError);
    }
    
    return res.json({
      success: true,
      message: savedMessage || { twilio_sid: twilioMessage.sid }
    });
    
  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * POST /api/messaging/webhook
 * Receive incoming messages from Twilio
 */
async function receiveWebhook(req, res) {
  try {
    const { From, To, Body, MessageSid, NumMedia } = req.body;
    
    const supabase = getSupabase();
    const normalizedFrom = normalizePhone(From);
    const normalizedTo = normalizePhone(To);
    
    // Find shop by Twilio number
    const { data: shopNumbers } = await supabase
      .from('shop_twilio_numbers')
      .select('*')
      .eq('phone_number', normalizedTo)
      .eq('provisioning_status', 'active')
      .limit(1);
    
    if (!shopNumbers || shopNumbers.length === 0) {
      console.error('No shop found for Twilio number:', normalizedTo);
      return res.status(404).send('Number not found');
    }
    
    const shopNumber = shopNumbers[0];
    
    // Find or create customer
    let customerId = null;
    const { data: customers } = await supabase
      .from('customers')
      .select('*')
      .eq('shop_id', shopNumber.shop_id)
      .eq('phone_normalized', normalizedFrom)
      .limit(1);
    
    if (customers && customers.length > 0) {
      customerId = customers[0].id;
    }
    
    // Find or create thread
    const thread = await findOrCreateThread(shopNumber.shop_id, customerId, normalizedFrom, shopNumber.id);
    
    // Process media if present
    let mediaUrls = null;
    if (NumMedia && parseInt(NumMedia) > 0) {
      mediaUrls = [];
      for (let i = 0; i < parseInt(NumMedia); i++) {
        const mediaUrl = req.body[`MediaUrl${i}`];
        const contentType = req.body[`MediaContentType${i}`];
        if (mediaUrl) {
          mediaUrls.push({ url: mediaUrl, contentType });
        }
      }
    }
    
    // Save message to database
    await supabase
      .from('messages')
      .insert([{
        thread_id: thread.id,
        shop_id: shopNumber.shop_id,
        customer_id: customerId,
        twilio_message_sid: MessageSid,
        direction: 'inbound',
        from_number: normalizedFrom,
        to_number: normalizedTo,
        body: Body || '',
        media: mediaUrls,
        status: 'received',
        num_media: parseInt(NumMedia) || 0,
        received_at: new Date().toISOString()
      }]);
    
    return res.status(200).send('Message received');
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).send('Internal server error');
  }
}

/**
 * POST /api/messaging/status
 * Receive status callbacks from Twilio
 */
async function receiveStatusCallback(req, res) {
  try {
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;
    
    const supabase = getSupabase();
    
    const updateData = {
      status: MessageStatus,
      updated_at: new Date().toISOString()
    };
    
    if (MessageStatus === 'delivered') {
      updateData.delivered_at = new Date().toISOString();
    }
    
    if (ErrorCode) {
      updateData.error_code = ErrorCode;
      updateData.error_message = ErrorMessage;
    }
    
    await supabase
      .from('messages')
      .update(updateData)
      .eq('twilio_message_sid', MessageSid);
    
    return res.status(200).send('Status updated');
    
  } catch (error) {
    console.error('Error processing status callback:', error);
    return res.status(500).send('Internal server error');
  }
}

/**
 * GET /api/messaging/threads/:shopId
 * Get all threads for a shop
 */
async function getThreads(req, res) {
  try {
    const { shopId } = req.params;
    
    const supabase = getSupabase();
    
    const { data, error } = await supabase
      .from('threads')
      .select('*')
      .eq('shop_id', shopId)
      .eq('archived', false)
      .order('last_message_at', { ascending: false });
    
    if (error) throw error;
    
    return res.json({ threads: data || [] });
    
  } catch (error) {
    console.error('Error fetching threads:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * GET /api/messaging/messages/:threadId
 * Get all messages for a thread
 */
async function getMessages(req, res) {
  try {
    const { threadId } = req.params;
    
    const supabase = getSupabase();
    
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    
    return res.json({ messages: data || [] });
    
  } catch (error) {
    console.error('Error fetching messages:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * DELETE /api/messaging/numbers/:numberId
 * Release a Twilio number
 */
async function releaseNumber(req, res) {
  try {
    const { numberId } = req.params;
    
    const supabase = getSupabase();
    
    const { data: number, error: fetchError } = await supabase
      .from('shop_twilio_numbers')
      .select('*')
      .eq('id', numberId)
      .single();
    
    if (fetchError || !number) {
      return res.status(404).json({ error: 'Number not found' });
    }
    
    // Release from Twilio
    try {
      await getTwilioClient().incomingPhoneNumbers(number.twilio_sid).remove();
    } catch (twilioError) {
      console.error('Error releasing number from Twilio:', twilioError);
    }
    
    // Update status in database
    await supabase
      .from('shop_twilio_numbers')
      .update({
        provisioning_status: 'released',
        updated_at: new Date().toISOString()
      })
      .eq('id', numberId);
    
    return res.json({ success: true });
    
  } catch (error) {
    console.error('Error releasing number:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

module.exports = {
  provisionNumber,
  sendMessage,
  receiveWebhook,
  receiveStatusCallback,
  getThreads,
  getMessages,
  releaseNumber
};
