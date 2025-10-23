#!/usr/bin/env node

const fetch = require('node-fetch');

async function testAPI() {
  const API_BASE = 'http://localhost:3001/api';
  const TEST_URL = process.env.TARGET_URL || 'https://trustarc.com/';
  
  console.log('🧪 Testing Cookie Scanner API');
  console.log(`📍 Target URL: ${TEST_URL}`);
  console.log(`🔗 API Base: ${API_BASE}`);
  
  try {
    // 1. Check if server is running
    console.log('\n1️⃣ Checking server health...');
    const healthResponse = await fetch(`${API_BASE}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Health check failed: ${healthResponse.status}`);
    }
    const health = await healthResponse.json();
    console.log('✅ Server is healthy:', health);
    
    // 2. Start a scan
    console.log('\n2️⃣ Starting scan...');
    const scanResponse = await fetch(`${API_BASE}/scan/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: TEST_URL })
    });
    
    if (!scanResponse.ok) {
      const error = await scanResponse.text();
      throw new Error(`Scan start failed: ${scanResponse.status} - ${error}`);
    }
    
    const scanResult = await scanResponse.json();
    console.log('✅ Scan started:', scanResult);
    
    // 3. Wait and check for recent scans
    console.log('\n3️⃣ Waiting 10 seconds then checking recent scans...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const recentResponse = await fetch(`${API_BASE}/scan/recent?limit=5`);
    if (!recentResponse.ok) {
      throw new Error(`Recent scans failed: ${recentResponse.status}`);
    }
    
    const recentScans = await recentResponse.json();
    console.log('📊 Recent scans:', recentScans);
    
    // 4. If we have a recent scan, get its details
    if (recentScans.length > 0) {
      const latestScan = recentScans[0];
      console.log(`\n4️⃣ Getting details for scan: ${latestScan.id}`);
      
      const detailResponse = await fetch(`${API_BASE}/scan/status/${latestScan.id}`);
      if (!detailResponse.ok) {
        throw new Error(`Scan details failed: ${detailResponse.status}`);
      }
      
      const scanDetails = await detailResponse.json();
      console.log('🔍 Scan details:', {
        id: scanDetails.id,
        url: scanDetails.url,
        status: scanDetails.status,
        cookieCount: scanDetails.cookie_count,
        duration: scanDetails.duration,
        cookies: scanDetails.cookies?.slice(0, 3) // Show first 3 cookies
      });
      
      if (scanDetails.cookies && scanDetails.cookies.length > 0) {
        console.log('\n🍪 Sample cookies found:');
        scanDetails.cookies.slice(0, 5).forEach((cookie, i) => {
          console.log(`   ${i + 1}. ${cookie.name} = ${cookie.value?.substring(0, 30)}...`);
          console.log(`      Source: ${cookie.source} | Origin: ${cookie.origin?.substring(0, 50)}...`);
        });
      }
    }
    
    console.log('\n✅ API test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ API test failed:', error.message);
    
    // Additional debugging
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Troubleshooting:');
      console.log('   • Make sure the server is running: npm run server:dev');
      console.log('   • Check if port 3001 is available');
      console.log('   • Verify the server started without errors');
    }
    
    process.exit(1);
  }
}

// Run the test
testAPI();