// Test script to verify the enhanced cookie scanner integration
const CookieScanner = require('./server/scanner/cookieScanner');
const db = require('./server/database/db');

async function testIntegration() {
  console.log('🧪 Testing enhanced cookie scanner integration...\n');
  
  const scanner = new CookieScanner();
  
  try {
    // Test a simple website
    console.log('📊 Scanning test website...');
    const result = await scanner.scanWebsite('https://example.com');
    
    console.log(`✅ Scan completed successfully!`);
    console.log(`📈 Scan ID: ${result.scanId}`);
    console.log(`🍪 Cookies found: ${result.cookieCount}`);
    console.log(`⏱️  Duration: ${result.duration}ms`);
    
    // Check database storage
    const storedCookies = await db.getCookiesByScan(result.scanId);
    console.log(`💾 Cookies stored in database: ${storedCookies.length}`);
    
    // Show sample cookies with third-party detection
    const thirdPartyCookies = storedCookies.filter(c => c.third_party_domain);
    console.log(`🔍 Third-party cookies detected: ${thirdPartyCookies.length}`);
    
    if (thirdPartyCookies.length > 0) {
      console.log('\n📋 Sample third-party cookies:');
      thirdPartyCookies.slice(0, 3).forEach(cookie => {
        console.log(`   • ${cookie.name} → ${cookie.third_party_domain}`);
      });
    }
    
    console.log('\n✅ Integration test passed! Enhanced scanner is working correctly.');
    
  } catch (error) {
    console.error('❌ Integration test failed:', error.message);
  } finally {
    await scanner.cleanup();
    await db.close();
  }
}

// Run the test
testIntegration();