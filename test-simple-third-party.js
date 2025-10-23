// Simple test to check getThirdPartyDomain function directly
const CookieScanner = require('./server/scanner/cookieScanner');

function testGetThirdPartyDomain() {
  console.log('🧪 Testing getThirdPartyDomain function directly...\n');
  
  const scanner = new CookieScanner();
  
  // Mock network requests
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
  
  // Test the third-party detection
  const thirdPartyDetections = scanner.detectThirdPartyServices(mockNetworkRequests);
  console.log('🔍 Third-party detections:', thirdPartyDetections);
  
  // Test origins that should match
  const testOrigins = [
    'https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js:1:33585',
    'https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js',
    'inline/unknown',
    'https://someother.com/script.js'
  ];
  
  // Create a mock getThirdPartyDomain function with the detections
  const getThirdPartyDomain = (origin) => {
    if (!origin || origin === 'inline/unknown') return null;
    
    // Extract the base URL from stack traces (remove line:column)
    let cleanOrigin = origin;
    
    // Remove line:column numbers from stack traces
    const stackMatch = origin.match(/^(https?:\/\/[^:]+(?::\d+)?\/[^:]*?)(?::\d+:\d+)?$/);
    if (stackMatch) {
      cleanOrigin = stackMatch[1];
    }
    
    console.log(`[Third-Party Detection] Checking origin: ${origin} → cleaned: ${cleanOrigin}`);
    
    // Check if this origin matches any detected third-party script
    for (const [scriptUrl, trackingDomain] of thirdPartyDetections) {
      console.log(`[Third-Party Detection] Comparing with script: ${scriptUrl}`);
      
      // Try exact match first
      if (cleanOrigin === scriptUrl) {
        console.log(`[Third-Party Detection] ✅ EXACT MATCH ${cleanOrigin} → ${trackingDomain}`);
        return trackingDomain;
      }
      
      // Try partial matches
      if (cleanOrigin.includes(scriptUrl) || scriptUrl.includes(cleanOrigin)) {
        console.log(`[Third-Party Detection] ✅ PARTIAL MATCH ${cleanOrigin} → ${trackingDomain}`);
        return trackingDomain;
      }
    }
    
    console.log(`[Third-Party Detection] ❌ No match found for ${cleanOrigin}`);
    return null;
  };
  
  console.log('\n📊 Testing origins:');
  testOrigins.forEach(origin => {
    const result = getThirdPartyDomain(origin);
    console.log(`Origin: ${origin}`);
    console.log(`Result: ${result}`);
    console.log('---');
  });
}

testGetThirdPartyDomain();