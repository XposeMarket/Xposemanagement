#!/usr/bin/env node

/**
 * Vercel Deployment Verification Script
 * Run this to check if your deployment is working
 */

const https = require('https');

const VERCEL_URL = 'https://xpose-stripe-server.vercel.app';

console.log('🔍 Testing Vercel Deployment...\n');

// Test 1: Health Check
function testHealthCheck() {
  return new Promise((resolve, reject) => {
    console.log('Test 1: Health Check Endpoint');
    https.get(`${VERCEL_URL}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ Health check passed');
          console.log('   Response:', data);
          resolve();
        } else {
          console.log('❌ Health check failed');
          console.log('   Status:', res.statusCode);
          console.log('   Response:', data);
          reject(new Error(`Status ${res.statusCode}`));
        }
      });
    }).on('error', (err) => {
      console.log('❌ Health check failed - Network error');
      console.log('   Error:', err.message);
      reject(err);
    });
  });
}

// Test 2: CORS Headers
function testCORS() {
  return new Promise((resolve, reject) => {
    console.log('\nTest 2: CORS Configuration');
    
    const options = {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://www.xpose.management',
        'Access-Control-Request-Method': 'POST'
      }
    };
    
    const req = https.request(`${VERCEL_URL}/create-checkout-session`, options, (res) => {
      const corsHeader = res.headers['access-control-allow-origin'];
      if (corsHeader) {
        console.log('✅ CORS headers present');
        console.log('   Allow-Origin:', corsHeader);
        resolve();
      } else {
        console.log('⚠️  CORS headers missing (might still work)');
        resolve();
      }
    });
    
    req.on('error', (err) => {
      console.log('⚠️  CORS test failed (might not be critical)');
      resolve(); // Don't fail the whole test
    });
    
    req.end();
  });
}

// Test 3: Checkout Endpoint (without actually creating a session)
function testCheckoutEndpoint() {
  return new Promise((resolve, reject) => {
    console.log('\nTest 3: Checkout Endpoint Availability');
    
    const postData = JSON.stringify({
      priceId: 'price_test_invalid'
    });
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      }
    };
    
    const req = https.request(`${VERCEL_URL}/create-checkout-session`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // We expect either 400 (bad request) or 500 (stripe error) - just not 404
        if (res.statusCode === 404) {
          console.log('❌ Endpoint not found (404)');
          console.log('   This means routing is broken in vercel.json');
          reject(new Error('404 Not Found'));
        } else if (res.statusCode >= 400 && res.statusCode < 600) {
          console.log('✅ Endpoint exists (responded with error as expected)');
          console.log('   Status:', res.statusCode);
          console.log('   Response:', data.substring(0, 200));
          resolve();
        } else {
          console.log('✅ Endpoint accessible');
          resolve();
        }
      });
    });
    
    req.on('error', (err) => {
      console.log('❌ Cannot reach endpoint');
      console.log('   Error:', err.message);
      reject(err);
    });
    
    req.write(postData);
    req.end();
  });
}

// Run all tests
async function runTests() {
  try {
    await testHealthCheck();
    await testCORS();
    await testCheckoutEndpoint();
    
    console.log('\n✅ All tests passed!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Test from your frontend at paywall.html');
    console.log('   2. Check Vercel dashboard for any function errors');
    console.log('   3. Monitor Stripe dashboard for incoming sessions');
    
  } catch (err) {
    console.log('\n❌ Tests failed!');
    console.log('\n🔧 Troubleshooting:');
    console.log('   1. Check Vercel deployment logs');
    console.log('   2. Verify all environment variables are set');
    console.log('   3. Make sure vercel.json routes are correct');
    console.log('   4. Try redeploying: vercel --prod');
    process.exit(1);
  }
}

runTests();
