/**
 * Terminal Registration Endpoint
 * POST /api/terminal/register
 * 
 * Registers a Stripe Terminal reader for a shop
 */

require('dotenv').config();

const HAS_STRIPE_KEY = !!process.env.STRIPE_SECRET_KEY;
let stripe = null;
if (HAS_STRIPE_KEY) {
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  } catch (err) {
    console.error('❌ Failed to initialize Stripe client:', err && err.message);
  }
}

// Initialize Supabase
let supabase = null;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;

if (supabaseUrl && supabaseKey) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ [Terminal Register] Supabase client initialized');
  } catch (err) {
    console.error('❌ [Terminal Register] Failed to initialize Supabase:', err.message);
  }
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { shopId, registrationCode } = req.body;
    
    if (!shopId || !registrationCode) {
      return res.status(400).json({ 
        error: 'Shop ID and registration code required' 
      });
    }

    // Validate registration code format (XXXXX-XXXXX)
    if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(registrationCode)) {
      return res.status(400).json({ 
        error: 'Invalid registration code format. Expected: XXXXX-XXXXX' 
      });
    }

    if (!supabase) {
      console.error('❌ [Terminal Register] Supabase client not initialized');
      return res.status(500).json({ error: 'Database connection not available' });
    }

    console.log(`🔍 [Terminal Register] Registering terminal for shop: ${shopId}`);
    console.log(`🔑 [Terminal Register] Registration code: ${registrationCode}`);

    // Get shop info
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('id, name, terminal_model, terminal_id')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      console.error('❌ [Terminal Register] Shop not found:', shopError);
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Check if shop already has a terminal
    if (shop.terminal_id) {
      console.log(`⚠️ [Terminal Register] Shop ${shopId} already has terminal ${shop.terminal_id}`);
      return res.status(400).json({ 
        error: 'Shop already has a registered terminal. Unregister the existing terminal first.',
        existing_terminal_id: shop.terminal_id
      });
    }

    // TEST MODE: Mock registration without hitting Stripe
    const TEST_MODE = process.env.TEST_MODE === 'true' || req.query.test === 'true';
    
    if (TEST_MODE) {
      console.log('🧪 [Terminal Register] TEST MODE: Simulating registration');

      const mockTerminalId = `tmr_test_${Date.now()}`;
      const mockSerial = `SIM-${registrationCode.replace('-', '')}`;

      // Save to database
      const { error: updateError } = await supabase
        .from('shops')
        .update({
          terminal_id: mockTerminalId,
          terminal_serial: mockSerial,
          terminal_status: 'online',
          terminal_model: shop.terminal_model || 'reader_m2'
        })
        .eq('id', shopId);

      if (updateError) {
        console.error('❌ [Terminal Register] Database update error:', updateError);
        return res.status(500).json({ error: 'Failed to save terminal info' });
      }

      console.log(`✅ [Terminal Register] Test terminal registered: ${mockTerminalId}`);

      return res.json({
        success: true,
        test_mode: true,
        reader: {
          id: mockTerminalId,
          serial: mockSerial,
          status: 'online',
          device_type: shop.terminal_model || 'reader_m2'
        },
        message: 'Terminal registered successfully (TEST MODE)'
      });
    }

    // PRODUCTION MODE: Real Stripe registration
    if (!stripe) {
      console.error('❌ [Terminal Register] Stripe not initialized');
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    // Create a location for this shop (required for terminal registration)
    let location;
    try {
      console.log(`📍 [Terminal Register] Creating Stripe location for shop ${shopId}`);
      
      location = await stripe.terminal.locations.create({
        display_name: shop.name || `Shop ${shopId}`,
        address: {
          line1: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          postal_code: '94111',
          country: 'US'
        }
      });

      console.log(`✅ [Terminal Register] Location created: ${location.id}`);
    } catch (locationError) {
      console.error('❌ [Terminal Register] Location creation error:', locationError);
      return res.status(500).json({ 
        error: 'Failed to create terminal location',
        details: locationError.message
      });
    }

    // In production, you would use the Stripe Terminal SDK on the physical device
    // to claim the reader using the registration code. For now, we'll simulate
    // by finding an available simulated reader.
    
    try {
      console.log('🔍 [Terminal Register] Looking for available readers...');
      
      const readers = await stripe.terminal.readers.list({
        limit: 100
      });

      console.log(`📋 [Terminal Register] Found ${readers.data.length} readers`);

      // Find a simulated reader (in test mode) or unassigned reader
      const availableReader = readers.data.find(r => 
        !r.location || r.status === 'offline'
      );
      
      if (!availableReader) {
        console.error('❌ [Terminal Register] No available readers found');
        return res.status(404).json({ 
          error: 'No available terminal found. Please create a simulated reader in your Stripe Dashboard for testing.',
          help: 'Go to: https://dashboard.stripe.com/test/terminal/readers'
        });
      }

      console.log(`✅ [Terminal Register] Found available reader: ${availableReader.id}`);

      // Assign reader to location
      const reader = await stripe.terminal.readers.update(
        availableReader.id,
        {
          location: location.id,
          label: `${shop.name || 'Shop'} Terminal`
        }
      );

      console.log(`✅ [Terminal Register] Reader assigned to location`);

      // Save terminal info to database
      const { error: updateError } = await supabase
        .from('shops')
        .update({
          terminal_id: reader.id,
          terminal_serial: reader.serial_number,
          terminal_status: reader.status,
          terminal_model: shop.terminal_model || 'reader_m2',
          location_id: location.id
        })
        .eq('id', shopId);

      if (updateError) {
        console.error('❌ [Terminal Register] Database update error:', updateError);
        return res.status(500).json({ error: 'Failed to save terminal info' });
      }

      console.log(`✅ [Terminal Register] Terminal registered successfully for shop ${shopId}`);

      return res.json({
        success: true,
        reader: {
          id: reader.id,
          serial: reader.serial_number,
          status: reader.status,
          device_type: reader.device_type
        },
        location: {
          id: location.id,
          display_name: location.display_name
        }
      });
    } catch (readerError) {
      console.error('❌ [Terminal Register] Reader registration error:', readerError);
      return res.status(500).json({ 
        error: readerError.message || 'Failed to register terminal',
        details: readerError.raw ? readerError.raw.message : null
      });
    }
  } catch (error) {
    console.error('❌ [Terminal Register] Unexpected error:', error);
    return res.status(500).json({ 
      error: error.message || 'Terminal registration failed' 
    });
  }
};
