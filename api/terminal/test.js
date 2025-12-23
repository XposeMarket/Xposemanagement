/**
 * Test Terminal Endpoints
 * Run with: node api/terminal/test.js
 */

require('dotenv').config();

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_SHOP_ID = process.env.TEST_SHOP_ID || 'YOUR_SHOP_ID_HERE';
const TEST_INVOICE_ID = process.env.TEST_INVOICE_ID || 'test-invoice-001';

console.log('🧪 Testing Terminal Endpoints');
console.log('================================');
console.log(`Base URL: ${BASE_URL}`);
console.log(`Shop ID: ${TEST_SHOP_ID}`);
console.log('');

// Helper to make requests
async function testEndpoint(name, method, endpoint, body = null) {
  console.log(`\n📡 Testing: ${name}`);
  console.log(`   ${method} ${endpoint}`);
  
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
      console.log(`   Body:`, body);
    }
    
    const response = await fetch(endpoint, options);
    const data = await response.json();
    
    console.log(`   Status: ${response.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));
    
    return { success: response.ok, data };
  } catch (error) {
    console.error(`   ❌ Error:`, error.message);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('Starting tests...\n');

  // Test 1: Check Terminal Status (should be not_registered initially)
  await testEndpoint(
    'Terminal Status (Initial)',
    'GET',
    `${BASE_URL}/api/terminal/status/${TEST_SHOP_ID}`
  );

  // Test 2: Register Terminal (TEST MODE)
  const registerResult = await testEndpoint(
    'Register Terminal (TEST MODE)',
    'POST',
    `${BASE_URL}/api/terminal/register?test=true`,
    {
      shopId: TEST_SHOP_ID,
      registrationCode: 'ABCDE-12345'
    }
  );

  // Test 3: Check Terminal Status (should be online now)
  await testEndpoint(
    'Terminal Status (After Registration)',
    'GET',
    `${BASE_URL}/api/terminal/status/${TEST_SHOP_ID}?test=true`
  );

  // Test 4: Create Payment (TEST MODE)
  if (registerResult.success) {
    await testEndpoint(
      'Create Terminal Payment (TEST MODE)',
      'POST',
      `${BASE_URL}/api/terminal/create-payment?test=true`,
      {
        invoiceId: TEST_INVOICE_ID,
        shopId: TEST_SHOP_ID
      }
    );
  } else {
    console.log('\n⚠️ Skipping payment test (registration failed)');
  }

  console.log('\n================================');
  console.log('✅ Tests Complete!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Check your Supabase shops table for terminal data');
  console.log('2. Go to your settings page and verify terminal shows as "Online"');
  console.log('3. Create a test invoice and try the Checkout button');
}

// Run tests
runTests().catch(console.error);
