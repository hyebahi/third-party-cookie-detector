// Direct test of the third-party logic without using the full scanner
// Clear require cache to ensure we get the latest version
delete require.cache[require.resolve('./server/scanner/cookieScanner')];
const CookieScanner = require('./server/scanner/cookieScanner');

function testDirectLogic() {
  console.log('🧪 Testing third-party logic directly...\n');
  
  const scanner = new CookieScanner();
  
  // Mock data
  const url = 'https://trustarc.com';
  const jsLogs = [
    {
      via: 'document.cookie',
      payload: 'rw_gclid=test123',
      stack: 'Error\n    at https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js:1:33585\n    at https://trustarc.com/:1:1',
      ts: Date.now(),
      detectedCaller: 'https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js:1:33585',
      callerScript: 'https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js'
    }
  ];
  
  const httpEvents = [];
  const browserCookies = [
    {
      name: 'rw_gclid',
      value: 'test123',
      domain: '.trustarc.com',
      path: '/',
      secure: true,
      httpOnly: false
    }
  ];
  
  const networkRequests = [
    {
      requestId: '1',
      url: 'https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js',
      method: 'GET',
      timestamp: Date.now()
    },
    {
      requestId: '2', 
      url: 'https://846-llz-652.mktoresp.com/track',
      method: 'POST',
      timestamp: Date.now()
    }
  ];
  
  const scriptGraph = {};
  const cookieCreationStacks = {};
  
  console.log('📊 Calling processResults directly...');
  
  try {
    const results = scanner.processResults(url, jsLogs, httpEvents, browserCookies, networkRequests, scriptGraph, cookieCreationStacks);
    
    console.log('\n✅ Results received:');
    console.log('Cookies:', results.cookies.length);
    
    results.cookies.forEach(cookie => {
      console.log(`\nCookie: ${cookie.name}`);
      console.log(`  Source: ${cookie.source}`);
      console.log(`  Origin: ${cookie.origin}`);
      console.log(`  Third Party: ${cookie.thirdParty}`);
      console.log(`  Third Party Domain: ${cookie.thirdPartyDomain}`);
    });
    
    // Check the result
    const rwCookie = results.cookies.find(c => c.name === 'rw_gclid');
    if (rwCookie) {
      console.log(`\n🎯 Expected: 846-llz-652.mktoresp.com`);
      console.log(`🎯 Actual: ${rwCookie.thirdPartyDomain}`);
      
      if (rwCookie.thirdPartyDomain === '846-llz-652.mktoresp.com') {
        console.log('🎉 SUCCESS!');
      } else {
        console.log('❌ FAILURE');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

testDirectLogic();