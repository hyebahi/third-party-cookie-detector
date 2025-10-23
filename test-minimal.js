// Minimal test to isolate the third-party domain issue
const CookieScanner = require('./server/scanner/cookieScanner');

function testMinimal() {
  console.log('🧪 Minimal test of third-party domain logic...\n');
  
  const scanner = new CookieScanner();
  
  // Test the detectThirdPartyServices function directly
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
  
  const thirdPartyDetections = scanner.detectThirdPartyServices(networkRequests);
  console.log('Third-party detections:', thirdPartyDetections);
  
  // Test the getThirdPartyDomain logic manually
  const origin = 'https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js:1:33585';
  
  // Extract the base URL from stack traces (remove line:column)
  let cleanOrigin = origin;
  const stackMatch = origin.match(/^(https?:\/\/[^:]+(?::\d+)?\/[^:]*?)(?::\d+:\d+)?$/);
  if (stackMatch) {
    cleanOrigin = stackMatch[1];
  }
  
  console.log(`\nTesting origin: ${origin}`);
  console.log(`Cleaned origin: ${cleanOrigin}`);
  
  // Check if this origin matches any detected third-party script
  let foundMatch = null;
  for (const [scriptUrl, trackingDomain] of thirdPartyDetections) {
    console.log(`Comparing with script: ${scriptUrl}`);
    
    // Try exact match first
    if (cleanOrigin === scriptUrl) {
      console.log(`✅ EXACT MATCH ${cleanOrigin} → ${trackingDomain}`);
      foundMatch = trackingDomain;
      break;
    }
    
    // Try partial matches
    if (cleanOrigin.includes(scriptUrl) || scriptUrl.includes(cleanOrigin)) {
      console.log(`✅ PARTIAL MATCH ${cleanOrigin} → ${trackingDomain}`);
      foundMatch = trackingDomain;
      break;
    }
  }
  
  if (foundMatch) {
    console.log(`\n🎉 SUCCESS: Found third-party domain: ${foundMatch}`);
  } else {
    console.log(`\n❌ FAILURE: No third-party domain found`);
  }
  
  // Now test what happens when we create a cookie with this origin
  console.log('\n--- Testing cookie creation ---');
  
  // Simulate the cookie creation logic
  const mockCookie = {
    name: 'rw_gclid',
    origin: origin,
    thirdPartyDomain: foundMatch
  };
  
  console.log('Mock cookie:', mockCookie);
}

testMinimal();