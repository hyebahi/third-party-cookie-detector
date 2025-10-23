#!/usr/bin/env node

const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3001/api';

async function testAPI() {
  console.log('🧪 Testing Cookie Scanner API\n');

  try {
    // Test health endpoint
    console.log('1. Testing health endpoint...');
    const healthResponse = await fetch(`${API_BASE}/health`);
    const health = await healthResponse.json();
    console.log('✅ Health check:', health.status);

    // Start a scan
    console.log('\n2. Starting scan for trustarc.com...');
    const scanResponse = await fetch(`${API_BASE}/scan/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://trustarc.com' })
    });
    const scanResult = await scanResponse.json();
    console.log('✅ Scan started:', scanResult.message);

    // Wait for scan to complete
    console.log('\n3. Waiting for scan to complete...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Get recent scans
    console.log('\n4. Fetching recent scans...');
    const recentResponse = await fetch(`${API_BASE}/scan/recent?limit=3`);
    const recentScans = await recentResponse.json();
    
    console.log(`✅ Found ${recentScans.length} recent scans:`);
    recentScans.forEach((scan, i) => {
      console.log(`   ${i + 1}. ${scan.url} - ${scan.status} (${scan.cookie_count} cookies)`);
    });

    // Get analytics
    console.log('\n5. Fetching analytics...');
    const analyticsResponse = await fetch(`${API_BASE}/results/analytics`);
    const analytics = await analyticsResponse.json();
    
    console.log('✅ Analytics:');
    console.log(`   Total scans: ${analytics.totalScans}`);
    console.log(`   Total cookies: ${analytics.totalCookies}`);
    console.log(`   Third-party cookies: ${analytics.thirdPartyCookies}`);

    console.log('\n🎉 API test completed successfully!');
    console.log('\n📊 Access the web dashboard at: http://localhost:3000');

  } catch (error) {
    console.error('❌ API test failed:', error.message);
  }
}

// Only run if called directly
if (require.main === module) {
  testAPI();
}

module.exports = testAPI;