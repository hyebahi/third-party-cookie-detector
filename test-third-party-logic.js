// Test script to verify third-party detection logic
const CookieScanner = require('./server/scanner/cookieScanner');

async function testThirdPartyLogic() {
  console.log('🧪 Testing third-party detection logic...\n');
  
  // Mock network requests that would be detected by the scanner
  const mockNetworkRequests = [
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
  
  // Mock JS logs that would be captured
  const mockJsLogs = [
    {
      via: 'document.cookie',
      payload: '_mkto_trk=id:846-LLZ-652-123456789',
      stack: 'Error\n    at https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js:1:33585\n    at https://trustarc.com/:1:1',
      ts: Date.now(),
      detectedCaller: 'https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js:1:33585',
      callerScript: 'https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js'
    }
  ];
  
  // Mock HTTP events
  const mockHttpEvents = [
    {
      via: 'HTTP Set-Cookie',
      url: 'https://info.trustarc.com/some-endpoint',
      setCookie: ['_mkto_trk=id:846-LLZ-652-123456; Domain=.trustarc.com; Path=/'],
      initiator: 'https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js:1:33585',
      ts: Date.now()
    }
  ];
  
  // Mock browser cookies
  const mockBrowserCookies = [
    {
      name: '_mkto_trk',
      value: 'id:846-LLZ-652-123456',
      domain: '.trustarc.com',
      path: '/',
      secure: true,
      httpOnly: false
    }
  ];
  
  const scanner = new CookieScanner();
  
  // Test the third-party detection
  const thirdPartyDetections = scanner.detectThirdPartyServices(mockNetworkRequests);
  console.log('🔍 Third-party detections:', thirdPartyDetections);
  
  // Test the processResults method with debugging
  console.log('\n🔧 Testing processResults with debugging...');
  console.log('Mock JS Logs:', JSON.stringify(mockJsLogs, null, 2));
  
  const results = scanner.processResults(
    'https://trustarc.com',
    mockJsLogs,
    mockHttpEvents,
    mockBrowserCookies,
    mockNetworkRequests,
    {},
    {}
  );
  
  console.log('\n📊 Processed Results:');
  results.cookies.forEach(cookie => {
    console.log(`Cookie: ${cookie.name}`);
    console.log(`  Source: ${cookie.source}`);
    console.log(`  Origin: ${cookie.origin}`);
    console.log(`  Third Party: ${cookie.thirdParty}`);
    console.log(`  Third Party Domain: ${cookie.thirdPartyDomain}`);
    console.log('---');
  });
  
  // Verify the expected behavior
  const mktoCookie = results.cookies.find(c => c.name === '_mkto_trk');
  if (mktoCookie) {
    console.log('\n✅ Test Results:');
    console.log(`Expected third-party domain: 846-llz-652.mktoresp.com`);
    console.log(`Actual third-party domain: ${mktoCookie.thirdPartyDomain}`);
    
    if (mktoCookie.thirdPartyDomain === '846-llz-652.mktoresp.com') {
      console.log('🎉 SUCCESS: Third-party domain correctly detected!');
    } else {
      console.log('❌ FAILURE: Third-party domain not correctly detected');
    }
  } else {
    console.log('❌ FAILURE: _mkto_trk cookie not found in results');
  }
}

// Run the test
testThirdPartyLogic().catch(console.error);