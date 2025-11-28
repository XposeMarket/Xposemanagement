/**
 * Twilio Messaging Backend for Xpose Management
 * Handles provisioning, sending, receiving, and status callbacks
 */

import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

// Lazy-load Twilio client to avoid module load failures in serverless
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
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }
  
  _supabase = createClient(supabaseUrl, supabaseServiceKey);
  return _supabase;
}

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://xposemanagement.com';

/**
 * Normalize phone number to E.164 format
 * Simple implementation - enhance with libphonenumber-js for production
 */
function normalizePhone(phone, defaultCountry = 'US') {
  if (!phone) return null;
  
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');
  
  // If starts with 1 and has 11 digits (US), format as +1...
  if (digits.length === 11 && digits[0] === '1') {
    return '+' + digits;
  }
  
  // If 10 digits (US without country code), add +1
  if (digits.length === 10 && defaultCountry === 'US') {
    return '+1' + digits;
  }
  
  // If already has +, return as-is
  if (phone.startsWith('+')) {
    return '+' + digits;
  }
  
  // Default: add + prefix
  return '+' + digits;
}

/**
 * Find or create customer by phone number
 */
async function findOrCreateCustomer(shopId, phoneNumber, additionalData = {}) {
  const normalized = normalizePhone(phoneNumber);
  
  // Try to find existing customer
  const { data: existing, error: findError } = await supabase
    .from('customers')
    .select('*')
    .eq('shop_id', shopId)
    .eq('phone_normalized', normalized)
    .single();
  
  if (existing && !findError) {
    return existing;
  }
  
  // Create new customer
  const { data: newCustomer, error: createError } = await supabase
    .from('customers')
    .insert([{
      shop_id: shopId,
      phone: phoneNumber,
      phone_normalized: normalized,
      first_name: additionalData.first_name || null,
      last_name: additionalData.last_name || null,
      email: additionalData.email || null,
      notes: additionalData.notes || null
    }])
    .select()
    .single();
  
  if (createError) {
    console.error('Error creating customer:', createError);
    throw createError;
  }
  
  return newCustomer;
}

/**
 * Find or create thread for a conversation
 */
async function findOrCreateThread(shopId, customerId, customerPhone, twilioNumberId) {
  const normalized = normalizePhone(customerPhone);
  
  // Try to find existing thread
  const { data: existing, error: findError } = await supabase
    .from('threads')
    .select('*')
    .eq('shop_id', shopId)
    .eq('external_recipient', normalized)
    .eq('twilio_number_id', twilioNumberId)
    .eq('archived', false)
    .single();
  
  if (existing && !findError) {
    return existing;
  }
  
  // Create new thread
  const { data: newThread, error: createError } = await supabase
    .from('threads')
    .insert([{
      shop_id: shopId,
      customer_id: customerId,
      twilio_number_id: twilioNumberId,
      external_recipient: normalized,
      subject: null,
      last_message: null,
      last_message_at: new Date().toISOString()
    }])
    .select()
    .single();
  
  if (createError) {
    console.error('Error creating thread:', createError);
    throw createError;
  }
  
  return newThread;
}

/**
 * ROUTE: POST /api/messaging/provision
 * Provision a new Twilio phone number for a shop
 * Body: { shopId, country, areaCode }
 */
export async function provisionNumber(req, res) {
  try {
    const { shopId, country = 'US', areaCode } = req.body;
    
    if (!shopId) {
      return res.status(400).json({ error: 'shopId is required' });
    }
    
    // Check if shop already has a number
    const { data: existingNumbers } = await supabase
      .from('shop_twilio_numbers')
      .select('*')
      .eq('shop_id', shopId)
      .eq('provisioning_status', 'active');
    
    if (existingNumbers && existingNumbers.length > 0) {
      return res.status(400).json({ 
        error: 'Shop already has an active number',
        existingNumber: existingNumbers[0]
      });
    }
    
    // Search for available numbers
    const searchParams = {
      smsEnabled: true,
      mmsEnabled: true,
      limit: 5
    };
    
    if (areaCode) {
      searchParams.areaCode = areaCode;
    }
    
    const availableNumbers = await twilioClient
      .availablePhoneNumbers(country)
      .local
      .list(searchParams);
    
    if (!availableNumbers || availableNumbers.length === 0) {
      return res.status(404).json({ error: 'No available phone numbers found' });
    }
    
    // Select the first available number
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
        monthly_cost: 5.00, // Your charge to shop
        twilio_monthly_cost: 1.00 // Actual Twilio cost
      }])
      .select()
      .single();
    
    if (saveError) {
      console.error('Error saving number to DB:', saveError);
      // Attempt to release the number from Twilio
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
    return res.status(500).json({ 
      error: 'Failed to provision number',
      details: error.message 
    });
  }
}

/**
 * ROUTE: POST /api/messaging/send
 * Send an outbound message
 * Body: { shopId, threadId, to, body, mediaUrls }
 */
export async function sendMessage(req, res) {
  try {
    const { shopId, threadId, to, body, mediaUrls } = req.body;
    
    if (!shopId || !to || !body) {
      return res.status(400).json({ error: 'shopId, to, and body are required' });
    }
    
    // Get shop's Twilio number
    const { data: twilioNumber, error: numberError } = await supabase
      .from('shop_twilio_numbers')
      .select('*')
      .eq('shop_id', shopId)
      .eq('provisioning_status', 'active')
      .single();
    
    if (numberError || !twilioNumber) {
      return res.status(404).json({ error: 'No active Twilio number found for this shop' });
    }
    
    const toNormalized = normalizePhone(to);
    
    // Find or create customer
    const customer = await findOrCreateCustomer(shopId, to);
    
    // Find or create thread (if threadId not provided)
    let thread;
    if (threadId) {
      const { data: existingThread } = await supabase
        .from('threads')
        .select('*')
        .eq('id', threadId)
        .single();
      thread = existingThread;
    } else {
      thread = await findOrCreateThread(shopId, customer.id, to, twilioNumber.id);
    }
    
    // Send via Twilio
    const messageParams = {
      from: twilioNumber.phone_number,
      to: toNormalized,
      body: body
    };
    
    if (mediaUrls && mediaUrls.length > 0) {
      messageParams.mediaUrl = mediaUrls;
    }
    
    const twilioMessage = await getTwilioClient().messages.create(messageParams);
    
    // Save to database
    const { data: savedMessage, error: saveError } = await supabase
      .from('messages')
      .insert([{
        thread_id: thread.id,
        shop_id: shopId,
        customer_id: customer.id,
        twilio_message_sid: twilioMessage.sid,
        direction: 'outbound',
        from_number: twilioNumber.phone_number,
        to_number: toNormalized,
        body: body,
        media: mediaUrls ? mediaUrls.map(url => ({ url, contentType: 'image/jpeg' })) : null,
        status: twilioMessage.status,
        sent_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (saveError) {
      console.error('Error saving message to DB:', saveError);
      return res.status(500).json({ error: 'Message sent but failed to save to database' });
    }
    
    return res.json({
      success: true,
      message: savedMessage,
      twilioSid: twilioMessage.sid
    });
    
  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json({ 
      error: 'Failed to send message',
      details: error.message 
    });
  }
}

/**
 * ROUTE: POST /api/messaging/webhook
 * Receive incoming messages from Twilio
 */
export async function receiveWebhook(req, res) {
  try {
    // Validate Twilio signature (recommended for production)
    const twilioSignature = req.headers['x-twilio-signature'];
    const url = `${APP_BASE_URL}${req.originalUrl}`;
    
    // Uncomment to enable signature validation:
    // if (!twilio.validateRequest(twilioAuthToken, twilioSignature, url, req.body)) {
    //   return res.status(403).send('Forbidden');
    // }
    
    const {
      MessageSid,
      From,
      To,
      Body,
      NumMedia,
      MediaUrl0,
      MediaContentType0
    } = req.body;
    
    console.log('📨 Incoming message:', { MessageSid, From, To, Body });
    
    // Find shop by phone number
    const { data: twilioNumber, error: numberError } = await supabase
      .from('shop_twilio_numbers')
      .select('*')
      .eq('phone_number', To)
      .single();
    
    if (numberError || !twilioNumber) {
      console.error('No shop found for number:', To);
      return res.status(404).send('<Response></Response>');
    }
    
    const shopId = twilioNumber.shop_id;
    
    // Find or create customer
    const customer = await findOrCreateCustomer(shopId, From);
    
    // Find or create thread
    const thread = await findOrCreateThread(shopId, customer.id, From, twilioNumber.id);
    
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
    const { data: savedMessage, error: saveError } = await supabase
      .from('messages')
      .insert([{
        thread_id: thread.id,
        shop_id: shopId,
        customer_id: customer.id,
        twilio_message_sid: MessageSid,
        direction: 'inbound',
        from_number: normalizePhone(From),
        to_number: To,
        body: Body || '',
        media: media.length > 0 ? media : null,
        status: 'received',
        received_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (saveError) {
      console.error('Error saving inbound message:', saveError);
    }
    
    console.log('✅ Inbound message saved:', savedMessage?.id);
    
    // Respond to Twilio with empty TwiML
    res.type('text/xml');
    res.send('<Response></Response>');
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.type('text/xml');
    res.send('<Response></Response>');
  }
}

/**
 * ROUTE: POST /api/messaging/status
 * Receive status callbacks from Twilio (delivery receipts)
 */
export async function receiveStatusCallback(req, res) {
  try {
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;
    
    console.log('📊 Status callback:', { MessageSid, MessageStatus, ErrorCode });
    
    // Update message status in database
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
    
    const { error: updateError } = await getSupabase()
      .from('messages')
      .update(updateData)
      .eq('twilio_message_sid', MessageSid);
    
    if (updateError) {
      console.error('Error updating message status:', updateError);
    }
    
    res.send('OK');
    
  } catch (error) {
    console.error('Error processing status callback:', error);
    res.send('OK');
  }
}

/**
 * ROUTE: GET /api/messaging/threads/:shopId
 * Get all threads for a shop
 */
export async function getThreads(req, res) {
  try {
    const { shopId } = req.params;
    
    const { data: threads, error } = await supabase
      .from('threads')
      .select(`
        *,
        customer:customers(*),
        twilio_number:shop_twilio_numbers(*)
      `)
      .eq('shop_id', shopId)
      .eq('archived', false)
      .order('last_message_at', { ascending: false });
    
    if (error) {
      throw error;
    }
    
    return res.json({ threads });
    
  } catch (error) {
    console.error('Error fetching threads:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch threads',
      details: error.message 
    });
  }
}

/**
 * ROUTE: GET /api/messaging/messages/:threadId
 * Get all messages for a thread
 */
export async function getMessages(req, res) {
  try {
    const { threadId } = req.params;
    
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    
    if (error) {
      throw error;
    }
    
    // Mark thread as read (reset unread_count)
    await supabase
      .from('threads')
      .update({ unread_count: 0 })
      .eq('id', threadId);
    
    return res.json({ messages });
    
  } catch (error) {
    console.error('Error fetching messages:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch messages',
      details: error.message 
    });
  }
}

/**
 * ROUTE: DELETE /api/messaging/numbers/:numberId
 * Release/deprovision a Twilio number
 */
export async function releaseNumber(req, res) {
  try {
    const { numberId } = req.params;
    
    // Get number details
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
      // Continue to mark as released in DB even if Twilio fails
    }
    
    // Update status in database
    const { error: updateError } = await getSupabase()
      .from('shop_twilio_numbers')
      .update({ 
        provisioning_status: 'released',
        updated_at: new Date().toISOString()
      })
      .eq('id', numberId);
    
    if (updateError) {
      return res.status(500).json({ error: 'Failed to update database' });
    }
    
    return res.json({ success: true });
    
  } catch (error) {
    console.error('Error releasing number:', error);
    return res.status(500).json({ 
      error: 'Failed to release number',
      details: error.message 
    });
  }
}

export default {
  provisionNumber,
  sendMessage,
  receiveWebhook,
  receiveStatusCallback,
  getThreads,
  getMessages,
  releaseNumber,
  normalizePhone
};
