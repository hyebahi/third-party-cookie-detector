// mvp-cookie-attribution.js
// npm i playwright
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/** ---------- Helpers ---------- */
function topFrameFromStack(stack = '') {
  // Try multiple patterns to find the best frame
  const frames = stack.match(/https?:\/\/[^\s)]+:\d+:\d+/g) || [];
  
  // Prefer frames that aren't our instrumentation
  for (const frame of frames) {
    if (!frame.includes('<anonymous>') && !frame.includes('eval')) {
      return frame;
    }
  }
  
  // Fallback to first frame if available
  return frames[0] || 'inline/unknown';
}
function extractCookieNameValue(input) {
  const first = (input || '').split(';', 1)[0];
  const eq = first.indexOf('=');
  if (eq === -1) return { name: first.trim(), value: '' };
  return { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
}
function valuePreview(value, max = 60) {
  return value.length <= max ? value : value.slice(0, max) + '…';
}

/** ---------- Tag Manager detectors ----------
 * Each detector should return a short label for the container/source when it matches.
 */
const TAG_MANAGER_DETECTORS = [
  // Google Tag Manager
  {
    name: 'GTM',
    fromStack: (s) => {
      const m = s.match(/googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/i);
      return m ? m[1] : null;
    },
    globalsProbe: () => null, // optional: dataLayer exists on many sites; not specific enough
  },
  // Adobe Launch (and legacy DTM)
  {
    name: 'AdobeLaunch',
    fromStack: (s) => {
      // Example: https://assets.adobedtm.com/launch-ENxxxxxxx.js
      const m1 = s.match(/assets\.adobedtm\.com\/(launch-[A-Za-z0-9-_.]+)/i);
      if (m1) return `AdobeLaunch:${m1[1]}`;
      // Legacy DTM: https://assets.adobedtm.com/xxxx/satelliteLib-xxxx.js
      const m2 = s.match(/assets\.adobedtm\.com\/.*\/(satelliteLib-[A-Za-z0-9-_.]+)/i);
      if (m2) return `AdobeDTM:${m2[1]}`;
      return null;
    },
    globalsProbe: () => {
      try {
        if (globalThis._satellite?.buildInfo) {
          const b = globalThis._satellite.buildInfo;
          return `Adobe:${b.environment || 'env?'}:${b.name || 'lib'}`;
        }
      } catch {} // eslint-disable-line
      return null;
    }
  },
  // Tealium iQ
  {
    name: 'Tealium',
    fromStack: (s) => {
      // Example: https://tags.tiqcdn.com/utag/account/profile/env/utag.js
      const m = s.match(/tags\.tiqcdn\.com\/utag\/([^/]+)\/([^/]+)\/([^/]+)\/utag(\.sync)?\.js/i);
      if (m) return `Tealium:${m[1]}/${m[2]}/${m[3]}`;
      return null;
    },
    globalsProbe: () => {
      try {
        if (globalThis.utag && globalThis.utag.cfg) {
          const c = globalThis.utag.cfg;
          return `Tealium:${c.ac || '?'}\/${c.pr || '?'}\/${c.env || '?'}`;
        }
      } catch {}
      return null;
    }
  },
  // Segment
  {
    name: 'Segment',
    fromStack: (s) => {
      // Example: https://cdn.segment.com/analytics.js/v1/<writeKey>/analytics.min.js
      const m = s.match(/cdn\.segment\.com\/analytics\.js\/v1\/([^/]+)\//i);
      if (m) return `Segment:${m[1]}`; // write key
      return null;
    },
    globalsProbe: () => {
      try {
        // Best effort: Segment queues on window.analytics; writeKey is not always exposed
        if (Array.isArray(globalThis.analytics)) return 'Segment:(analytics array)';
      } catch {}
      return null;
    }
  }
];

/** Try to derive a friendly label (GTM, Adobe, Tealium, Segment) from a stack. */
function labelFromStack(stack) {
  for (const det of TAG_MANAGER_DETECTORS) {
    const lbl = det.fromStack?.(stack);
    if (lbl) return lbl;
  }
  return null;
}

/** ---------- Third-party service detection ---------- */
function detectThirdPartyServices(networkRequests) {
  const detections = new Map(); // scriptUrl -> thirdPartyDomain
  
  // Client ID patterns that indicate external services using client domains
  const clientIdPatterns = [
    /\/[a-z]{1,3}\/([A-Z0-9-]{6,20})\//,           // /rs/846-LLZ-652/ or /api/CLIENT-123/
    /\/([0-9]{3,4}-[A-Z]{2,4}-[0-9]{3,4})\//,     // /846-LLZ-652/
    /\/clients?\/([a-zA-Z0-9-]+)\//,               // /client/company-name/
    /\/accounts?\/([a-zA-Z0-9-]+)\//,              // /account/account-id/
    /\/[a-z]+\/v[0-9]+\/([a-zA-Z0-9-]+)\//,       // /api/v1/client-id/
    /\/tenant\/([a-zA-Z0-9-]+)\//,                 // /tenant/tenant-id/
  ];
  
  // Get script requests (JS files)
  const scriptRequests = networkRequests.filter(r => 
    r.url.endsWith('.js') && r.method === 'GET'
  );
  
  // Get data requests (POST/tracking requests)
  const dataRequests = networkRequests.filter(r => 
    r.method === 'POST' || r.url.includes('analytics') || r.url.includes('tracking')
  );
  
  console.log(`[Third-Party Detection] Analyzing ${scriptRequests.length} script requests and ${dataRequests.length} data requests`);
  
  // Look for client ID patterns that appear in both script URLs and tracking URLs
  scriptRequests.forEach(scriptReq => {
    try {
      const scriptUrl = new URL(scriptReq.url);
      
      // Check if script URL contains a client ID pattern
      let clientId = null;
      for (const pattern of clientIdPatterns) {
        const match = scriptUrl.pathname.match(pattern);
        if (match) {
          clientId = match[1];
          break;
        }
      }
      
      if (clientId) {
        console.log(`[Third-Party Detection] Found client ID "${clientId}" in script: ${scriptReq.url}`);
        
        // Check if same client ID appears in any tracking requests
        const matchingDataReq = dataRequests.find(dataReq => {
          const lowerUrl = dataReq.url.toLowerCase();
          const lowerClientId = clientId.toLowerCase();
          return lowerUrl.includes(lowerClientId) || 
                 lowerUrl.includes(lowerClientId.replace(/-/g, ''));
        });
        
        if (matchingDataReq) {
          try {
            const dataDomain = new URL(matchingDataReq.url).hostname;
            const scriptDomain = scriptUrl.hostname;
            
            // If tracking domain is different from script domain = third-party service
            if (dataDomain !== scriptDomain) {
              detections.set(scriptReq.url, dataDomain);
              console.log(`[Third-Party Detection] ✅ DETECTED: Script ${scriptReq.url} sends data to third-party ${dataDomain} (Client ID: ${clientId})`);
            }
          } catch (e) {
            console.warn(`[Third-Party Detection] Error parsing data URL: ${matchingDataReq.url}`);
          }
        }
      }
    } catch (e) {
      console.warn(`[Third-Party Detection] Error parsing script URL: ${scriptReq.url}`);
    }
  });
  
  return detections;
}

(async () => {
  // Optionally use system Chrome instead of bundled Chromium
  const useChrome = String(process.env.PLAYWRIGHT_USE_CHROME || '').toLowerCase() === 'true';
  const chromePathEnv = process.env.PLAYWRIGHT_CHROME_PATH || '';
  let launchOpts = { headless: false };
  if (useChrome) {
    // Try provided path, else try common locations
    const candidates = [];
    if (chromePathEnv) candidates.push(chromePathEnv);
    // macOS default
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    // Linux defaults
    candidates.push('/usr/bin/google-chrome');
    candidates.push('/usr/bin/chromium-browser');
    candidates.push('/usr/bin/chromium');
    // Windows-ish (WSL paths won't be used here, but added for completeness)
    candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');

    const found = candidates.find(p => p && fs.existsSync(p));
    if (found) {
      launchOpts.executablePath = found;
      console.log('Launching system Chrome at:', found);
    } else if (chromePathEnv) {
      // user provided a path but it doesn't exist — warn and continue with bundled chromium
      console.warn('PLAYWRIGHT_CHROME_PATH was provided but path not found:', chromePathEnv);
    } else {
      console.warn('PLAYWRIGHT_USE_CHROME=true but no Chrome binary found in common locations; using bundled Chromium');
    }
  }
  const browser = await chromium.launch(launchOpts);
  // Allow overriding the User-Agent via env PLAYWRIGHT_USER_AGENT
  // Default to a modern Chrome user-agent (macOS) to behave like Chrome by default
  const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  let userAgent = process.env.PLAYWRIGHT_USER_AGENT || DEFAULT_UA;
  // Support shorthand: PLAYWRIGHT_USER_AGENT=chrome
  if (userAgent && (userAgent.toLowerCase() === 'chrome' || userAgent.toLowerCase() === 'google-chrome')) {
    userAgent = DEFAULT_UA;
  }
  const context = await browser.newContext({ userAgent });
  const page = await context.newPage();

  /** ---------- CDP hookup for HTTP Set-Cookie initiators ---------- */
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  
  // Enable monitoring for all frames, not just main frame
  try {
    await cdp.send('Page.enable');
    await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });
    console.log('[CDP] Multi-frame monitoring enabled');
  } catch (e) {
    console.warn('[CDP] Could not enable multi-frame monitoring:', e.message);
  }
  
  console.log('[CDP] Network monitoring enabled');

  const initiators = new Map(); // requestId -> initiator
  let requestCount = 0;
  cdp.on('Network.requestWillBeSent', evt => {
    requestCount++;
    initiators.set(evt.requestId, evt.initiator || null);
    
    // Store network requests for third-party service detection
    networkRequests.push({
      requestId: evt.requestId,
      url: evt.request.url,
      method: evt.request.method,
      timestamp: evt.timestamp
    });
    
    // Check for Facebook-related requests
    const url = evt.request.url.toLowerCase();
    const isFacebookRequest = ['facebook.com', 'facebook.net', 'fbcdn.net', 'connect.facebook.net']
      .some(domain => url.includes(domain)) || 
      ['fbevents', 'fbq', 'pixel', '_fbp', '_fbc'].some(pattern => url.includes(pattern));
    
    if (isFacebookRequest) {
      console.log(`[Facebook Tracker] 📡 Facebook request detected: ${evt.request.method} ${evt.request.url}`);
      if (evt.initiator?.stack?.callFrames?.length) {
        const topFrame = evt.initiator.stack.callFrames[0];
        console.log(`[Facebook Tracker] Initiated from: ${topFrame.url}:${topFrame.lineNumber}`);
      }
    }
    
    if (requestCount % 10 === 0) {
      console.log(`[CDP] Processed ${requestCount} requests`);
    }
  });

  const httpEvents = []; // {url, setCookie[], initiator, ts}
  const networkRequests = []; // Store all network requests for third-party detection
  let responseCount = 0;
  let setCookieCount = 0;
  let crossOriginResponses = 0;
  
  cdp.on('Network.responseReceived', async evt => {
    responseCount++;
    const { requestId, response } = evt;
    
    // Debug: log some responses to see what we're getting
    if (responseCount <= 5 || responseCount % 50 === 0) {
      console.log(`[CDP Debug] Response ${responseCount}: ${response.url} (${response.status})`);
      console.log(`[CDP Debug] Headers:`, Object.keys(response.headers || {}).slice(0, 10));
    }
    
    const headers = response.headers || {};
    
    // Check for Set-Cookie in various case combinations
    const setCookie = headers['set-cookie'] || headers['Set-Cookie'] || 
                     headers['SET-COOKIE'] || headers['Set-cookie'];
    
    if (setCookie) {
      setCookieCount++;
      const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
      const init = initiators.get(requestId);
      let origin = 'unknown';
      if (init?.stack?.callFrames?.length) {
        const top = init.stack.callFrames[0];
        origin = `${top.url}:${top.lineNumber + 1}:${top.columnNumber + 1}`;
      } else if (init?.url) {
        origin = init.url;
      } else if (response?.url) {
        origin = response.url;
      }
      httpEvents.push({
        via: 'HTTP Set-Cookie',
        url: response.url,
        setCookie: arr,
        initiator: origin,
        ts: Date.now(),
      });
      console.log(`[CDP] HTTP Set-Cookie detected: ${response.url} -> ${arr.length} cookies`);
      console.log(`[CDP] Cookies: ${arr.map(c => c.split(';')[0]).join(', ')}`);
    }
    
    // Debug: Check if any response has cookie-related headers we might be missing
    const allHeaders = Object.keys(headers).filter(h => 
      h.toLowerCase().includes('cookie') || h.toLowerCase().includes('auth')
    );
    if (allHeaders.length > 0 && !setCookie) {
      console.log(`[CDP Debug] Cookie-related headers without Set-Cookie: ${response.url}`, allHeaders);
    }
    
    // Special tracking for cross-origin responses that might have cookies
    const responseUrl = new URL(response.url);
    const pageUrl = new URL(page.url());
    const isCrossOrigin = responseUrl.origin !== pageUrl.origin;
    
    if (isCrossOrigin) {
      crossOriginResponses++;
      // Look for cookie-setting patterns in cross-origin requests
      const isTrackingUrl = /\b(analytics|tracking|pixel|sync|cookie|consent|ads?|doubleclick|google|facebook|linkedin|bing|marketo|adobe|demdex)\b/i.test(response.url);
      
      if (setCookie || response.status >= 300 && response.status < 400 || isTrackingUrl) {
        console.log(`[CDP Cross-Origin] ${response.status} ${response.url} (${setCookie ? 'HAS' : 'NO'} Set-Cookie)${isTrackingUrl ? ' [TRACKING]' : ''}`);
        if (response.status >= 300 && response.status < 400) {
          const location = headers.location || headers.Location;
          if (location) {
            console.log(`[CDP Redirect] ${response.url} -> ${location}`);
          }
        }
      }
    }
  });

  /** ---------- Page instrumentation (runs before any page script) ---------- */
  await page.addInitScript((detectorsSrc) => {
    // Deserialize detectors on the page side
    const DETECTORS = new Map(detectorsSrc);
    
    // Enhanced Facebook pixel tracking
    const FACEBOOK_DOMAINS = ['facebook.com', 'facebook.net', 'fbcdn.net', 'connect.facebook.net'];
    const FACEBOOK_COOKIES = ['_fbp', '_fbc', 'fr', 'datr', 'sb', 'c_user', 'xs'];
    const FACEBOOK_PATTERNS = ['fbevents', 'facebook', 'fbq', 'pixel', '_fbp', '_fbc'];
    
    console.log('[Facebook Tracker] Initialized Facebook pixel detection');
    
    // Monitor for Facebook Pixel API calls
    if (window.fbq) {
      console.log('[Facebook Tracker] 🎯 Facebook Pixel (fbq) already loaded!');
    }
    
    // Override fbq if it gets loaded
    const originalFbq = window.fbq;
    Object.defineProperty(window, 'fbq', {
      configurable: true,
      enumerable: true,
      get() {
        return this._fbq;
      },
      set(value) {
        console.log('[Facebook Tracker] 🎯 Facebook Pixel (fbq) being set!', typeof value);
        if (typeof value === 'function') {
          this._fbq = new Proxy(value, {
            apply(target, thisArg, argumentsList) {
              console.log('[Facebook Tracker] 🎯 fbq() called with:', argumentsList);
              return target.apply(thisArg, argumentsList);
            }
          });
        } else {
          this._fbq = value;
        }
      }
    });

    // Enhanced shared store
    window.__cookieMvp = {
      jsLogs: [],
      scriptGraph: {},      // childScriptUrl -> parentLabelOrFrame
      containerLabels: new Set(), // detected TM labels
      initialCookies: new Set(), // Track cookies present at instrumentation time
      periodicSnapshots: [], // Periodic cookie snapshots to detect delayed creation
      cookieCreationStacks: new Map(), // cookieName -> detailed stack info
      resourceChain: [], // Track resource loading chain for attribution
      facebookEvents: [], // Specific tracking for Facebook-related events
    };

    // Capture initial cookie state to compare against later
    try {
      const initialCookieNames = document.cookie.split(';')
        .map(c => c.trim().split('=')[0])
        .filter(n => n);
      initialCookieNames.forEach(name => window.__cookieMvp.initialCookies.add(name));
      console.log(`[Cookie MVP] Initial cookies detected: ${initialCookieNames.length}`);
    } catch {}

    const detectLabel = (stack) => {
      for (const [name, fns] of DETECTORS.entries()) {
        try {
          const lbl = fns.fromStack?.(stack);
          if (lbl) return lbl;
        } catch {}
      }
      return null;
    };

    // Function to analyze stack and find the real script that created the cookie
    const analyzeStackForOrigin = (stack, cookieName) => {
      const stackLines = stack.split('\n');
      
      // Find the first external script URL in the stack (excluding our wrapper code)
      for (let i = 1; i < stackLines.length; i++) {
        const line = stackLines[i];
        
        // Look for actual script URLs
        const urlMatch = line.match(/https?:\/\/[^\s)]+/);
        if (urlMatch && !urlMatch[0].includes('<anonymous>')) {
          return {
            origin: urlMatch[0],
            reason: 'stack-trace-analysis',
            evidence: `Found in stack: ${line.trim()}`
          };
        }
        
        // Also check for eval contexts that might have origin info
        const evalMatch = line.match(/eval.*https?:\/\/[^\s)]+/);
        if (evalMatch) {
          const evalUrl = evalMatch[0].match(/https?:\/\/[^\s)]+/);
          if (evalUrl) {
            return {
              origin: evalUrl[0],
              reason: 'eval-context-analysis',
              evidence: `Found in eval context: ${line.trim()}`
            };
          }
        }
      }
      
      return {
        origin: 'inline/unknown',
        reason: 'no-external-script-found',
        evidence: 'No external scripts found in stack trace'
      };
    };

    // Enhanced cookie event recording with better origin detection
    const recordJsCookie = (via, cookieOrArgs, extraInfo = {}) => {
      const stack = new Error().stack || '';
      const lbl = detectLabel(stack);
      if (lbl) window.__cookieMvp.containerLabels.add(lbl);
      
      // Extract cookie name for origin analysis
      let cookieName = null;
      if (via === 'document.cookie') {
        const firstPart = (cookieOrArgs || '').split(';')[0];
        const eqIndex = firstPart.indexOf('=');
        cookieName = eqIndex === -1 ? firstPart.trim() : firstPart.slice(0, eqIndex).trim();
      } else if (via === 'cookieStore.set' && extraInfo.cookieName) {
        cookieName = extraInfo.cookieName;
      }
      
      // Check if this is a Facebook cookie
      const isFacebookCookie = FACEBOOK_COOKIES.includes(cookieName);
      if (isFacebookCookie) {
        console.log(`[Facebook Tracker] 🎯 Facebook cookie detected: ${cookieName}`);
        console.log(`[Facebook Tracker] Stack trace:`, stack);
        
        // Analyze the resource chain for Facebook attribution
        const recentFacebookResources = window.__cookieMvp.resourceChain
          .filter(r => r.timestamp > Date.now() - 10000) // Last 10 seconds
          .filter(r => FACEBOOK_DOMAINS.some(domain => r.url.includes(domain)) || 
                      r.url.includes('facebook') || r.url.includes('fbevents'));
        
        console.log(`[Facebook Tracker] Recent Facebook resources:`, recentFacebookResources);
        
        window.__cookieMvp.facebookEvents.push({
          cookieName,
          via,
          payload: cookieOrArgs,
          stack,
          recentFacebookResources,
          timestamp: Date.now()
        });
      }
      
      // Perform stack trace analysis only - no inference
      let originAnalysis = null;
      if (cookieName) {
        originAnalysis = analyzeStackForOrigin(stack, cookieName);
        window.__cookieMvp.cookieCreationStacks.set(cookieName, {
          stack: stack,
          via: via,
          analysis: originAnalysis,
          timestamp: Date.now()
        });
      }
      
      // Enhanced stack capture - get more frames for better attribution
      const stackFrames = stack.split('\n').slice(1, 10); // Get more frames, skip Error constructor
      const enhancedStack = stackFrames.join('\n');
      
      window.__cookieMvp.jsLogs.push({ 
        via, 
        payload: cookieOrArgs, 
        stack: enhancedStack, 
        originalStack: stack,
        ts: Date.now(),
        cookieName: cookieName,
        originAnalysis: originAnalysis,
        isFacebookCookie: isFacebookCookie,
        ...extraInfo
      });
      
      if (originAnalysis && originAnalysis.reason === 'stack-trace-analysis') {
        console.log(`[Cookie MVP] ${cookieName} created by: ${originAnalysis.origin}`);
      }
    };

    // 1) Enhanced document.cookie wrapper
    try {
      const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                   Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
      if (desc?.set) {
        const originalSet = desc.set;
        Object.defineProperty(document, 'cookie', {
          configurable: true, enumerable: true,
          get: desc.get ? desc.get.bind(document) : () => '',
          set(cookieString) {
            // Get the full stack trace and extract meaningful caller information
            const fullStack = new Error().stack || '';
            const stackLines = fullStack.split('\n');
            
            // Find the first external script URL (not our wrapper, not eval, not anonymous)
            let actualCaller = 'inline/unknown';
            let callerScript = null;
            
            for (let i = 1; i < stackLines.length; i++) {
              const line = stackLines[i];
              // Look for actual script URLs
              const urlMatch = line.match(/https?:\/\/[^\s)]+/);
              if (urlMatch && !urlMatch[0].includes('<anonymous>')) {
                actualCaller = urlMatch[0];
                callerScript = urlMatch[0].split('?')[0]; // Remove query params
                break;
              }
              // Also check for eval contexts that might have origin info
              const evalMatch = line.match(/eval.*https?:\/\/[^\s)]+/);
              if (evalMatch) {
                const evalUrl = evalMatch[0].match(/https?:\/\/[^\s)]+/);
                if (evalUrl) {
                  actualCaller = evalUrl[0];
                  callerScript = evalUrl[0].split('?')[0];
                  break;
                }
              }
            }
            
            recordJsCookie('document.cookie', cookieString, {
              detectedCaller: actualCaller,
              callerScript: callerScript,
              fullStackLines: stackLines.slice(1, 8), // First 7 stack frames for debugging
              wrapperDetected: true
            });
            return originalSet.call(document, cookieString);
          }
        });
      }
    } catch {}

    // 2) Cookie Store API
    try {
      if ('cookieStore' in window && window.cookieStore?.set) {
        const orig = window.cookieStore.set.bind(window.cookieStore);
        window.cookieStore.set = async (...args) => {
          // Extract cookie name from cookieStore.set arguments
          const cookieInfo = args[0];
          if (cookieInfo && typeof cookieInfo === 'object' && cookieInfo.name) {
            // Convert to document.cookie format for consistent parsing
            const cookieString = `${cookieInfo.name}=${cookieInfo.value || ''}`;
            recordJsCookie('cookieStore.set', cookieString, { 
              originalArgs: JSON.stringify(args),
              cookieName: cookieInfo.name,
              cookieValue: cookieInfo.value || ''
            });
          } else {
            recordJsCookie('cookieStore.set', JSON.stringify(args));
          }
          return orig(...args);
        };
      }
    } catch {}

    // 3) Focus only on actual cookie creation operations

    // 4) Enhanced cookie attribution - track resource loading for cookie attribution
    // Store script/iframe loading history to attribute cookies to their sources
    window.__cookieMvp.recentScripts = new Map(); // URL -> {timestamp, parentScript}
    window.__cookieMvp.recentIframes = new Map(); // URL -> {timestamp, parentScript}
    
    // Enhanced resource tracking for Facebook attribution
    const trackResource = (url, type, parentScript) => {
      const isFacebookResource = FACEBOOK_DOMAINS.some(domain => url.includes(domain)) || 
                                FACEBOOK_PATTERNS.some(pattern => url.toLowerCase().includes(pattern.toLowerCase()));
      
      const resourceInfo = {
        url,
        type,
        timestamp: Date.now(),
        parentScript,
        isFacebookResource
      };
      
      window.__cookieMvp.resourceChain.push(resourceInfo);
      
      if (isFacebookResource) {
        console.log(`[Facebook Tracker] 📡 Facebook resource loaded: ${type} ${url}`);
        console.log(`[Facebook Tracker] Parent script: ${parentScript}`);
      }
      
      // Keep only recent resources (last 30 seconds)
      const cutoff = Date.now() - 30000;
      window.__cookieMvp.resourceChain = window.__cookieMvp.resourceChain.filter(r => r.timestamp > cutoff);
    };
    
    // Track script loading without recording as cookie events
    const originalAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function(child) {
      const stack = new Error().stack || '';
      const parentScript = (stack.match(/https?:\/\/[^\s)]+:\d+:\d+/) || [])[0] || 'inline/unknown';
      
      if (child.nodeName === 'SCRIPT' && child.src) {
        window.__cookieMvp.recentScripts.set(child.src, {
          timestamp: Date.now(),
          parentScript: parentScript
        });
        trackResource(child.src, 'script', parentScript);
      } else if (child.nodeName === 'IFRAME' && child.src) {
        window.__cookieMvp.recentIframes.set(child.src, {
          timestamp: Date.now(),
          parentScript: parentScript
        });
        trackResource(child.src, 'iframe', parentScript);
      }
      return originalAppendChild.call(this, child);
    };
    
    // Track iframe src setting without recording as cookie events
    const originalCreateElementBase = document.createElement.bind(document);
    document.createElement = function(tagName) {
      const element = originalCreateElementBase(tagName);
      if (tagName.toLowerCase() === 'iframe') {
        const originalSrcSetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')?.set;
        if (originalSrcSetter) {
          Object.defineProperty(element, 'src', {
            configurable: true,
            enumerable: true,
            get() {
              return element.getAttribute('src');
            },
            set(value) {
              const stack = new Error().stack || '';
              const parentScript = (stack.match(/https?:\/\/[^\s)]+:\d+:\d+/) || [])[0] || 'inline/unknown';
              
              window.__cookieMvp.recentIframes.set(value, {
                timestamp: Date.now(),
                parentScript: parentScript
              });
              
              trackResource(value, 'iframe-src', parentScript);
              
              return originalSrcSetter.call(element, value);
            }
          });
        }
      }
      return element;
    };
    
    // Track image loading (Facebook pixel tracking)
    const originalImageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (originalImageSrc && originalImageSrc.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: true,
        get: originalImageSrc.get,
        set(value) {
          const stack = new Error().stack || '';
          const parentScript = (stack.match(/https?:\/\/[^\s)]+:\d+:\d+/) || [])[0] || 'inline/unknown';
          
          trackResource(value, 'image', parentScript);
          
          return originalImageSrc.set.call(this, value);
        }
      });
    }

    // 5) Periodic cookie monitoring to detect changes not captured by direct instrumentation
    const takeSnapshot = () => {
      try {
        const currentCookies = document.cookie.split(';')
          .map(c => c.trim().split('=')[0])
          .filter(n => n);
        
        const newCookies = currentCookies.filter(name => !window.__cookieMvp.initialCookies.has(name));
        
        if (newCookies.length > 0) {
          recordJsCookie('periodic.detection', `New cookies: ${newCookies.join(', ')}`, {
            newCookies,
            totalCookies: currentCookies.length,
            detectionMethod: 'periodic-snapshot'
          });
          // Add new cookies to our tracking set
          newCookies.forEach(name => window.__cookieMvp.initialCookies.add(name));
        }
        
        window.__cookieMvp.periodicSnapshots.push({
          ts: Date.now(),
          cookieCount: currentCookies.length,
          cookieNames: [...currentCookies]
        });
      } catch {}
    };

    // Take snapshots at intervals to catch delayed cookie setting
    setTimeout(() => takeSnapshot(), 1000);   // 1s after instrumentation
    setTimeout(() => takeSnapshot(), 3000);   // 3s after instrumentation  
    setTimeout(() => takeSnapshot(), 5000);   // 5s after instrumentation
    setTimeout(() => takeSnapshot(), 10000);  // 10s after instrumentation
    setTimeout(() => takeSnapshot(), 15000);  // 15s after instrumentation

    // 6) Monitor for consent management API calls that might trigger cookie setting
    try {
      // Monitor Truste/OneTrust consent changes
      if (window.addEventListener) {
        window.addEventListener('message', (event) => {
          if (event.data && typeof event.data === 'object') {
            if (event.data.type === 'onetrust' || event.data.type === 'truste') {
              recordJsCookie('consent.message', JSON.stringify(event.data), {
                detectionMethod: 'consent-postmessage',
                origin: event.origin
              });
            }
          }
        });
      }
    } catch {}

    // 7) Script parent → child attribution with label awareness (preserve existing logic)
    const originalCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function(tagName, options) {
      const el = originalCreateElement.call(this, tagName, options);
      if ((tagName || '').toLowerCase() === 'script') {
        let _src = '';
        const stackForThisScript = () => {
          const s = new Error().stack || '';
          const lbl = detectLabel(s);
          if (lbl) return lbl; // Prefer TM label
          const top = (s.match(/https?:\/\/[^\s)]+:\d+:\d+/) || [])[0];
          return top || 'inline/unknown';
        };

        try {
          Object.defineProperty(el, 'src', {
            configurable: true, enumerable: true,
            get() { return _src; },
            set(v) {
              _src = v;
              const parent = stackForThisScript();
              (window.__cookieMvp.scriptGraph[_src] ||= parent);
            }
          });
        } catch {}

        const _setAttribute = el.setAttribute;
        el.setAttribute = function(name, value) {
          if (name && name.toLowerCase() === 'src') {
            try {
              const parent = stackForThisScript();
              (window.__cookieMvp.scriptGraph[value] ||= parent);
            } catch {}
          }
          return _setAttribute.call(this, name, value);
        };
      }
      return el;
    };

    // 4) Optional: probe globals to pick up labels even if not in stack
    try {
      // Adobe
      if (window._satellite?.buildInfo) {
        const b = window._satellite.buildInfo;
        window.__cookieMvp.containerLabels.add(`Adobe:${b.environment || 'env?'}:${b.name || 'lib'}`);
      }
      // Tealium
      if (window.utag?.cfg) {
        const c = window.utag.cfg;
        window.__cookieMvp.containerLabels.add(`Tealium:${c.ac || '?'}\/${c.pr || '?'}\/${c.env || '?'}`);
      }
      // Segment heuristic
      if (Array.isArray(window.analytics)) {
        window.__cookieMvp.containerLabels.add('Segment:(analytics array)');
      }
    } catch {}
  }, TAG_MANAGER_DETECTORS.map(d => [d.name, { fromStack: d.fromStack?.toString?.() ? eval : null }]));

  // Note: the above serialized function trick is simplified by passing only "fromStack"
  // If your runtime complains, you can inline the detector regexes directly in addInitScript.

  /** ---------- Go! ---------- */

  // Helper: robust navigation with retries
  async function robustGoto(page, url) {
    // Single quick attempt: user requested only one attempt with a reduced timeout
    const attempts = [
        { waitUntil: 'domcontentloaded', timeout: 15000 },
      ];

    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const opts = attempts[i];
      try {
        console.log(`Attempt ${i + 1}/${attempts.length}: goto ${url} (waitUntil=${opts.waitUntil}, timeout=${opts.timeout}ms)`);
        await page.goto(url, opts);
        return; // success
      } catch (err) {
        lastErr = err;
        console.error(`Navigation attempt ${i + 1} failed: ${err.message}`);
        // small backoff before retry
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
    // If the final failure is an HTTP2 protocol error, treat it as recoverable: log and continue.
    const msg = String(lastErr?.message || '').toLowerCase();
    if (msg.includes('err_http2_protocol_error') || msg.includes('http2 protocol')) {
      console.warn(`Ignoring HTTP/2 protocol error for ${url}; proceeding with best-effort page state. Last error: ${lastErr?.message}`);
      return;
    }

    // All attempts failed - rethrow the most recent error
    const e = new Error(`robustGoto failed for ${url}: ${lastErr?.message || 'unknown'}`);
    e.cause = lastErr;
    throw e;
  }

  const TARGET_URL = process.env.TARGET_URL || 'http://trustarc.com/';
  
  // Set TrustArc cookies before navigation
  console.log('Setting TrustArc cookies...');
  const targetUrl = new URL(TARGET_URL);
  const domain = targetUrl.hostname;
  
  const trustarcCookies = [
    {
      name: 'notice_behavior',
      value: 'implied,eu',
      domain: domain,
      path: '/'
    },
    {
      name: 'cmapi_cookie_privacy',
      value: 'permit 1,2,3',
      domain: domain,
      path: '/'
    },
    {
      name: 'notice_gdpr_prefs',
      value: '0,1,2:',
      domain: domain,
      path: '/'
    },
    {
      name: 'notice_preferences',
      value: '2:',
      domain: domain,
      path: '/'
    }
  ];
  
  for (const cookie of trustarcCookies) {
    try {
      await context.addCookies([cookie]);
      console.log(`Set cookie: ${cookie.name}=${cookie.value} for domain ${cookie.domain}`);
    } catch (e) {
      console.warn(`Failed to set cookie ${cookie.name}:`, e.message);
    }
  }
  
  await robustGoto(page, TARGET_URL);
  await page.waitForTimeout(2000); // Wait a bit longer for initial scripts to load

  // Log the effective user agent from the page for debugging
  try {
    const seenUa = await page.evaluate(() => navigator.userAgent);
    console.log('Page reports navigator.userAgent =', seenUa);
  } catch (e) {
    console.warn('Could not read navigator.userAgent from page:', e && e.message);
  }

  // Prepare placeholders for instrumentation results
  let jsLogs = [];
  let scriptGraph = {};
  let containerLabels = [];

  // Wait for initial scripts to load and set cookies
  console.log('Waiting for initial page scripts to load...');
  await page.waitForTimeout(5000);

  // Grab the instrumentation data from the page
  let cookieCreationStacks = {};
  let facebookEvents = [];
  let resourceChain = [];
  try {
    const resPost = await page.evaluate(() => {
      if (!window.__cookieMvp) return null;
      return {
        jsLogs: window.__cookieMvp.jsLogs || [],
        scriptGraph: window.__cookieMvp.scriptGraph || {},
        containerLabels: Array.from(window.__cookieMvp.containerLabels || []),
        cookieCreationStacks: Object.fromEntries(window.__cookieMvp.cookieCreationStacks || new Map()),
        facebookEvents: window.__cookieMvp.facebookEvents || [],
        resourceChain: window.__cookieMvp.resourceChain || [],
      };
    });
    if (resPost) {
      jsLogs = resPost.jsLogs || [];
      scriptGraph = resPost.scriptGraph || {};
      containerLabels = resPost.containerLabels || [];
      cookieCreationStacks = resPost.cookieCreationStacks || {};
      facebookEvents = resPost.facebookEvents || [];
      resourceChain = resPost.resourceChain || [];
      
      console.log(`Captured ${jsLogs.length} JS cookie operations and ${httpEvents.length} HTTP Set-Cookie events`);
      console.log(`[CDP Summary] Processed ${responseCount} responses (${crossOriginResponses} cross-origin), found ${setCookieCount} with Set-Cookie headers`);
      console.log(`[Origin Analysis] Analyzed ${Object.keys(cookieCreationStacks).length} cookie creation origins`);
      console.log(`[Facebook Analysis] Captured ${facebookEvents.length} Facebook cookie events`);
      console.log(`[Resource Chain] Tracked ${resourceChain.length} resource loads`);
      
      // Enhanced Facebook cookie analysis
      if (facebookEvents.length > 0) {
        console.log('\n=== FACEBOOK COOKIE ANALYSIS ===');
        facebookEvents.forEach((event, i) => {
          console.log(`\n[Facebook Event ${i + 1}] Cookie: ${event.cookieName}`);
          console.log(`  Via: ${event.via}`);
          console.log(`  Payload: ${event.payload}`);
          console.log(`  Recent Facebook Resources:`);
          event.recentFacebookResources.forEach(resource => {
            console.log(`    - ${resource.type}: ${resource.url}`);
            console.log(`      Parent: ${resource.parentScript}`);
          });
          
          // Analyze the stack for Tealium connection
          const stackLines = event.stack.split('\n');
          const tealiumFrames = stackLines.filter(line => line.includes('tiqcdn.com'));
          if (tealiumFrames.length > 0) {
            console.log(`  Tealium Connection Found:`);
            tealiumFrames.forEach(frame => console.log(`    ${frame.trim()}`));
          }
        });
        console.log('================================\n');
      }
      
      // Log the detailed origin analysis for debugging
      Object.entries(cookieCreationStacks).forEach(([cookieName, info]) => {
        if (info.analysis && info.analysis.reason === 'stack-trace-analysis') {
          console.log(`[Origin Analysis] ${cookieName} -> ${info.analysis.origin}`);
        }
      });
    } else {
      console.warn('Instrumentation store not found on page (window.__cookieMvp)');
    }
  } catch (e) {
    console.error('Failed to evaluate page instrumentation:', e && e.message);
  }

  // Alternative approach: Create synthetic HTTP events from actual browser storage
  // Since CDP doesn't capture cross-origin tracking cookie setting, we create synthetic events
  try {
    console.log('[CDP] Creating synthetic HTTP events for uncaptured cookies...');
    
    // Get all cookies from browser storage
    const actualCookies = await context.cookies();
    console.log(`[CDP Synthetic] Found ${actualCookies.length} total cookies in browser storage`);
    
    // Build set of cookies we already captured via network or JS
    const capturedCookieNames = new Set();
    
    // Add cookies captured via HTTP Set-Cookie headers
    httpEvents.forEach(evt => {
      evt.setCookie.forEach(sc => {
        const { name } = extractCookieNameValue(sc);
        capturedCookieNames.add(name);
      });
    });
    
    // Add cookies captured via JS instrumentation (check all JS operations, not just document.cookie)
    jsLogs.forEach(log => {
      // Extract cookie name from various JS operation types
      let cookieName = null;
      
      if (log.via === 'document.cookie') {
        const { name } = extractCookieNameValue(log.payload);
        cookieName = name;
      } else if (log.via === 'cookieStore.set' && log.cookieInfo?.name) {
        // cookieStore.set operations with extracted name
        cookieName = log.cookieInfo.name;
      } else if (log.payload && typeof log.payload === 'string') {
        // Try multiple patterns to extract cookie names
        let match = log.payload.match(/^([^=]+)=/); // "name=value" format
        if (!match) {
          match = log.payload.match(/['"']([^'"=]+)['"']\s*[:=]/); // '"name": value' or "'name' = value" format
        }
        if (!match) {
          match = log.payload.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*[:=]/); // general name:value or name=value
        }
        if (match) {
          cookieName = match[1].trim();
        }
      }
      
      if (cookieName) {
        capturedCookieNames.add(cookieName);
      }
    });
    
    console.log(`[CDP Synthetic] Already captured ${capturedCookieNames.size} cookies via network/JS monitoring`);
    console.log(`[DEBUG] Captured cookie names:`, Array.from(capturedCookieNames).sort());
    
    // Special handling: if TrustArc is detected, attribute related consent cookies to TrustArc JS
    const trustArcOrigin = jsLogs.find(log => log.via && log.via.includes('trustarc.com'))?.via;
    console.log(`[DEBUG] TrustArc origin found:`, trustArcOrigin);
    console.log(`[DEBUG] Has notice_behavior:`, capturedCookieNames.has('notice_behavior'));
    if (trustArcOrigin && capturedCookieNames.has('notice_behavior')) {
      const trustArcConsentCookies = actualCookies.filter(cookie => 
        (cookie.name.startsWith('cmapi_') || cookie.name.startsWith('notice_')) && 
        !capturedCookieNames.has(cookie.name)
      );
      
      // Add TrustArc consent cookies to JS rows instead of HTTP synthetic events
      for (const cookie of trustArcConsentCookies) {
        const existingRow = rows.find(row => row.name === cookie.name);
        if (!existingRow) {
          rows.push({
            name: cookie.name,
            valuePreview: valuePreview(cookie.value),
            sourceKind: 'JS',
            origin: trustArcOrigin,
            via: 'consent-management',
          });
          capturedCookieNames.add(cookie.name); // Mark as captured
        }
      }
    }

    // Create synthetic HTTP events for missing cookies
    let syntheticCount = 0;
    for (const cookie of actualCookies) {
      if (!capturedCookieNames.has(cookie.name)) {
        syntheticCount++;
        
        // Reconstruct the Set-Cookie header string
        let setCookieHeader = `${cookie.name}=${cookie.value}`;
        if (cookie.domain) setCookieHeader += `; Domain=${cookie.domain}`;
        if (cookie.path) setCookieHeader += `; Path=${cookie.path}`;
        if (cookie.secure) setCookieHeader += `; Secure`;
        if (cookie.httpOnly) setCookieHeader += `; HttpOnly`;
        if (cookie.sameSite) setCookieHeader += `; SameSite=${cookie.sameSite}`;
        if (cookie.expires && cookie.expires > 0) {
          setCookieHeader += `; Expires=${new Date(cookie.expires * 1000).toUTCString()}`;
        }
        
        // Determine likely origin URL for this cookie
        let originUrl = `https://${cookie.domain.replace(/^\./, '')}/`;
        
        // Create synthetic HTTP event
        httpEvents.push({
          via: 'HTTP Set-Cookie (Synthetic)',
          url: originUrl,
          setCookie: [setCookieHeader],
          initiator: originUrl,
          ts: Date.now(),
          synthetic: true
        });
      }
    }
    
    if (syntheticCount > 0) {
      console.log(`[CDP Synthetic] Added ${syntheticCount} synthetic HTTP events for undetected cookies`);
      console.log(`[CDP Final] Total HTTP events: ${httpEvents.length} (${syntheticCount} synthetic + ${httpEvents.length - syntheticCount} network-captured)`);
    }
  } catch (e) {
    console.warn('[CDP Synthetic] Could not create synthetic events:', e.message);
  }  // Quick cookie count check before building the final table
  try {
    const quickCheck = await context.cookies();
    console.log(`Browser has ${quickCheck.length} cookies in storage before building final table`);
  } catch (e) {
    console.warn('Could not check cookie count:', e && e.message);
  }

  /** ---------- Build rows ---------- */
  const rows = [];
  const cookieFirstSeen = new Map(); // Track first occurrence of each cookie
  const cookieLatestValue = new Map(); // Track latest value for each cookie
  
  // Detect third-party services using network request analysis
  const thirdPartyDetections = detectThirdPartyServices(networkRequests);
  console.log(`[Third-Party Detection] Found ${thirdPartyDetections.size} third-party service scripts`);
  
  // Log all detections
  thirdPartyDetections.forEach((trackingDomain, scriptUrl) => {
    console.log(`[Third-Party Service] ${scriptUrl} → ${trackingDomain}`);
  });
  
  // Helper function to get third-party tracking domain for an origin
  const getThirdPartyDomain = (origin) => {
    if (!origin || origin === 'inline/unknown') return null;
    
    // Extract the base URL from stack traces (remove line:column)
    const cleanOrigin = origin.split(':').slice(0, -2).join(':') || origin;
    
    // Check if this origin matches any detected third-party script
    for (const [scriptUrl, trackingDomain] of thirdPartyDetections) {
      if (cleanOrigin.includes(scriptUrl) || scriptUrl.includes(cleanOrigin)) {
        return trackingDomain;
      }
    }
    return null;
  };

  // Build a priority map: JS operations take precedence over HTTP synthetic events
  const jsCookieNames = new Set();
  
  // First pass: collect all JS cookie names
  for (let i = 0; i < jsLogs.length; i++) {
    const log = jsLogs[i];
    if (log.via === 'document.cookie') {
      const { name } = extractCookieNameValue(log.payload);
      if (name) {
        if (name.includes('notice_') || name.includes('cmapi_')) {
          console.log(`[Attribution Debug] Operation ${i}: JS cookie: ${name} from payload: ${log.payload.substring(0, 100)}`);
        }
        jsCookieNames.add(name);
      } else {
        console.log(`[Attribution Debug] Operation ${i}: Failed to extract name from payload: ${log.payload.substring(0, 80)}...`);
      }
    } else if (log.via === 'cookieStore.set') {
      const { name } = extractCookieNameValue(log.payload);
      if (name) jsCookieNames.add(name);
    }
  }
  
  console.log(`[Attribution] JS operations detected for cookies: ${Array.from(jsCookieNames).join(', ')}`);
  console.log(`[Attribution Debug] Total jsLogs processed: ${jsLogs.length}, unique cookie names: ${jsCookieNames.size}`);

  // JS-set cookies
  for (const log of jsLogs) {
    const via = log.via;
    const payload = log.payload;
    
    // Priority order for origin detection:
    // 1. detectedCaller (from improved wrapper)
    // 2. callerScript (script URL without line numbers)
    // 3. callerStack (original approach)
    // 4. original stack as fallback
    let stackTop = 'inline/unknown';
    let stackUrlOnly = 'inline/unknown';
    let stackToUse = log.callerStack || log.stack; // Define in broader scope
    
    if (log.detectedCaller && log.detectedCaller !== 'inline/unknown') {
      stackTop = log.detectedCaller;
      stackUrlOnly = log.callerScript || log.detectedCaller.split(':').slice(0, -2).join(':');
    } else {
      stackTop = topFrameFromStack(stackToUse);
      stackUrlOnly = stackTop.split(':').slice(0, -2).join(':') || stackTop;
    }

    let parent = scriptGraph[stackUrlOnly] || scriptGraph[stackTop] || null;
    if (!parent) {
      const lbl = (stackToUse && (function s2lbl(s){
        const gtm = s.match(/googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/i);
        if (gtm) return gtm[1];
        const ad1 = s.match(/assets\.adobedtm\.com\/(launch-[A-Za-z0-9-_.]+)/i);
        if (ad1) return `AdobeLaunch:${ad1[1]}`;
        const ad2 = s.match(/assets\.adobedtm\.com\/.*\/(satelliteLib-[A-Za-z0-9-_.]+)/i);
        if (ad2) return `AdobeDTM:${ad2[1]}`;
        const tl = s.match(/tags\.tiqcdn\.com\/utag\/([^/]+)\/([^/]+)\/([^/]+)\/utag/i);
        if (tl) return `Tealium:${tl[1]}/${tl[2]}/${tl[3]}`;
        const seg = s.match(/cdn\.segment\.com\/analytics\.js\/v1\/([^/]+)\//i);
        if (seg) return `Segment:${seg[1]}`;
        return null;
      })(stackToUse));
      if (lbl) parent = lbl;
    }
    
    // Show the original script that created the cookie (clean, simple attribution)
    const origin = stackTop;

    if (via === 'document.cookie') {
      const { name, value } = extractCookieNameValue(payload);
      
      // Track the latest value for this cookie
      cookieLatestValue.set(name, value);
      
      // Only add row if this is the first time we see this cookie name
      if (!cookieFirstSeen.has(name)) {
        const thirdPartyDomain = getThirdPartyDomain(origin);
        cookieFirstSeen.set(name, { source: 'JS', origin, via });
        rows.push({
          name,
          valuePreview: valuePreview(value), // Will be updated later with latest value
          sourceKind: 'JS',
          origin,
          via,
          thirdPartyDomain: thirdPartyDomain || null,
        });
      }
    } else {
      // Handle cookieStore.set and other operations
      if (via === 'cookieStore.set') {
        // Try to extract cookie name from cookieStore.set
        const { name, value } = extractCookieNameValue(payload);
        if (name) {
          // Track the latest value for this cookie
          cookieLatestValue.set(name, value);
          
          // Only add row if this is the first time we see this cookie name
          if (!cookieFirstSeen.has(name)) {
            const thirdPartyDomain = getThirdPartyDomain(origin);
            cookieFirstSeen.set(name, { source: 'JS', origin, via });
            rows.push({
              name,
              valuePreview: valuePreview(value),
              sourceKind: 'JS',
              origin,
              via,
              thirdPartyDomain: thirdPartyDomain || null,
            });
          }
        } else {
          // Fallback for unparseable cookieStore.set
          const thirdPartyDomain = getThirdPartyDomain(origin);
          rows.push({
            name: '(cookieStore.set - unparseable)',
            valuePreview: String(payload).slice(0, 60) + '…',
            sourceKind: 'JS',
            origin,
            via,
            thirdPartyDomain: thirdPartyDomain || null,
          });
        }
      } else {
        // Handle other JS operations that might set cookies (like TrustArc consent)
        let cookieName = null;
        let cookieValue = null;
        
        // Try to extract cookie name/value from payload using multiple patterns
        if (payload && typeof payload === 'string') {
          let match = payload.match(/^([^=]+)=(.*)$/); // "name=value" format
          if (match) {
            cookieName = match[1].trim();
            cookieValue = match[2];
          } else {
            // Try other patterns
            match = payload.match(/['"']([^'"=]+)['"']\s*[:=]\s*['"']([^'"]*)['"']/); // '"name": "value"' format
            if (match) {
              cookieName = match[1].trim();
              cookieValue = match[2];
            }
          }
        }
        
        if (cookieName) {
          // Track the latest value for this cookie
          cookieLatestValue.set(cookieName, cookieValue || '');
          
          // Only add row if this is the first time we see this cookie name
          if (!cookieFirstSeen.has(cookieName)) {
            const thirdPartyDomain = getThirdPartyDomain(origin);
            cookieFirstSeen.set(cookieName, { source: 'JS', origin, via });
            rows.push({
              name: cookieName,
              valuePreview: valuePreview(cookieValue || ''),
              sourceKind: 'JS',
              origin,
              via,
              thirdPartyDomain: thirdPartyDomain || null,
            });
          }
        }
        // If we can't extract a cookie name, skip this operation (it's not a cookie operation)
      }
    }
  }

  // HTTP Set-Cookie
  for (const evt of httpEvents) {
    for (const line of evt.setCookie) {
      const { name, value } = extractCookieNameValue(line);
      
      // Track the latest value for this cookie
      cookieLatestValue.set(name, value);
      
      // Skip HTTP events for cookies that were detected via JavaScript (JS takes precedence)
      if (jsCookieNames.has(name)) {
        console.log(`[Attribution] Skipping HTTP event for ${name} - already detected via JS`);
        continue;
      }
      
      // Only add if this is the first time we see this cookie name
      if (!cookieFirstSeen.has(name)) {
        // Show the original script/URL that created the cookie (clean attribution)
        const origin = evt.initiator;
        const thirdPartyDomain = getThirdPartyDomain(origin);
        
        cookieFirstSeen.set(name, { source: 'HTTP', origin, via: 'HTTP Set-Cookie' });
        rows.push({
          name,
          valuePreview: valuePreview(value), // Will be updated later with latest value
          sourceKind: 'HTTP',
          origin,
          via: 'HTTP Set-Cookie',
          thirdPartyDomain: thirdPartyDomain || null,
        });
      }
    }
  }

  // Note detected containers
  if (containerLabels?.length) {
    rows.push({
      name: '(info)',
      valuePreview: `Detected: ${containerLabels.join(', ')}`,
      sourceKind: 'meta',
      origin: 'TM detection',
      via: 'instrumentation',
      thirdPartyDomain: null,
    });
  }

  // Merge browser-stored cookies (from context.cookies()) into the rows for visibility.
  // Try to map stored cookies back to an HTTP response URL (from httpEvents) so we can show the
  // actual origin URL that set the cookie. If not found, fall back to domain+attrs.
  try {
    const stored = await context.cookies();

    const findResponseUrlForName = (cookieName, cookieDomain) => {
      // 1) Check detailed origin analysis first (highest priority)
      if (cookieCreationStacks && cookieCreationStacks[cookieName]) {
        const stackInfo = cookieCreationStacks[cookieName];
        if (stackInfo.analysis && stackInfo.analysis.origin !== 'inline/unknown') {
          return stackInfo.analysis.origin;
        }
      }
      
      // 2) Prefer JS-origin matches (document.cookie or cookieStore.set) captured in jsLogs
      for (const log of jsLogs || []) {
        try {
          const via = String(log.via || '').toLowerCase();
          if (via.includes('cookie')) {
            const kv = extractCookieNameValue(log.payload || '');
            if (kv.name === cookieName) {
              // Check if this log has origin analysis
              if (log.originAnalysis && log.originAnalysis.origin !== 'inline/unknown') {
                return log.originAnalysis.origin;
              }
              // Fallback to stack analysis
              const top = topFrameFromStack(log.stack || '');
              if (top && top !== 'inline/unknown') return top;
            }
          }
        } catch {}
      }

      // 3) Prefer exact name match in captured Set-Cookie headers
      for (const evt of httpEvents) {
        for (const sc of evt.setCookie) {
          const first = (sc || '').split(';', 1)[0];
          const eq = first.indexOf('=');
          const nm = eq === -1 ? first.trim() : first.slice(0, eq).trim();
          if (nm === cookieName) return evt.url || evt.initiator || null;
        }
      }

      // 4) Fallback: try to match by domain/host (cookieDomain may be like '.example.com')
      if (cookieDomain) {
        const domStr = String(cookieDomain).replace(/^\./, '').toLowerCase();
        for (const evt of httpEvents) {
          try {
            const h = new URL(evt.url).host.toLowerCase();
            if (h === domStr || h.endsWith('.' + domStr)) return evt.url || evt.initiator || null;
          } catch {}
        }
      }

      return null;
    };

    for (const c of stored) {
      const attrs = [];
      if (c.httpOnly) attrs.push('HttpOnly');
      if (c.secure) attrs.push('Secure');
      if (c.sameSite) attrs.push(`SameSite=${c.sameSite}`);
      if (c.domain) attrs.push(`Domain=${c.domain}`);
      if (c.path) attrs.push(`Path=${c.path}`);
      const attrStr = attrs.length ? ` [${attrs.join(', ')}]` : '';

  const respUrl = findResponseUrlForName(c.name, c.domain);
      let originStr;
      if (respUrl) {
        originStr = `${respUrl}${attrStr}`;
      } else if (c.domain) {
        // Build a plausible origin URL from the cookie domain (prefer https)
        const hostGuess = String(c.domain).replace(/^\./, '');
        const guessed = `https://${hostGuess}/`;
        originStr = `${guessed}${attrStr}`;
      } else {
        originStr = `${c.domain || '(unknown)'}${attrStr}`;
      }

      // Track the latest value for this cookie (from browser storage - most authoritative)
      cookieLatestValue.set(c.name, c.value || '');
      
      // Only add browser cookies that weren't already captured during creation
      if (!cookieFirstSeen.has(c.name)) {
        const thirdPartyDomain = getThirdPartyDomain(originStr);
        cookieFirstSeen.set(c.name, { source: 'Browser', origin: originStr, via: 'context.cookies()' });
        rows.push({
          name: c.name,
          valuePreview: valuePreview(c.value || ''),
          sourceKind: 'Browser',
          origin: originStr,
          via: 'context.cookies()',
          thirdPartyDomain: thirdPartyDomain || null,
        });
      }
    }
  } catch (e) {
    console.warn('Could not read context.cookies() to merge into table:', e && e.message);
  }

  // Update all rows with latest values from browser storage
  for (const row of rows) {
    if (row.name !== '(cookieStore.set)' && cookieLatestValue.has(row.name)) {
      row.valuePreview = valuePreview(cookieLatestValue.get(row.name));
    }
  }

  // Detection completeness analysis
  try {
    const actualCookies = await context.cookies();
    const capturedViaJS = jsLogs.length;
    const capturedViaHTTP = httpEvents.reduce((sum, evt) => sum + evt.setCookie.length, 0);
    const totalActualCookies = actualCookies.length;
    
    console.log('\n=== COOKIE DETECTION ANALYSIS ===');
    console.log(`🔍 Total cookies in browser: ${totalActualCookies}`);
    console.log(`📝 JS operations captured: ${capturedViaJS}`);
    console.log(`🌐 HTTP Set-Cookie captured: ${capturedViaHTTP}`);
    console.log(`📊 Rows in table: ${rows.length}`);
    
    // Identify cookies that weren't detected during creation
    const detectedNames = new Set();
    jsLogs.forEach(log => {
      if (log.via === 'document.cookie') {
        const { name } = extractCookieNameValue(log.payload);
        detectedNames.add(name);
      }
    });
    httpEvents.forEach(evt => {
      evt.setCookie.forEach(sc => {
        const { name } = extractCookieNameValue(sc);
        detectedNames.add(name);
      });
    });
    
    const undetectedCookies = actualCookies.filter(c => !detectedNames.has(c.name));
    if (undetectedCookies.length > 0) {
      console.log(`\n⚠️  UNDETECTED COOKIES (${undetectedCookies.length}):`);
      undetectedCookies.forEach(cookie => {
        const attrs = [];
        if (cookie.httpOnly) attrs.push('HttpOnly');
        if (cookie.secure) attrs.push('Secure');
        if (cookie.sameSite) attrs.push(`SameSite=${cookie.sameSite}`);
        console.log(`   - ${cookie.name} [${attrs.join(', ')}] (domain: ${cookie.domain})`);
      });
      console.log('\n💡 These cookies were likely set via:');
      console.log('   • HTTP Set-Cookie headers during initial page load (before instrumentation)');
      console.log('   • HttpOnly cookies (not accessible to JavaScript)');
      console.log('   • Cross-origin iframe contexts');
      console.log('   • Server-side redirects or middleware');
    } else {
      console.log('✅ All cookies detected during creation!');
    }
    console.log('==================================\n');
  } catch (e) {
    console.warn('Could not perform detection analysis:', e.message);
  }

  // Print table with full origin information to show complete script URLs
  const displayRows = rows.map(row => ({
    name: row.name.length > 25 ? row.name.slice(0, 22) + '...' : row.name,
    value: row.valuePreview.length > 30 ? row.valuePreview.slice(0, 27) + '...' : row.valuePreview,
    source: row.sourceKind,
    origin: row.origin, // Show full origin URL/script path
    thirdParty: row.thirdPartyDomain || '' // Show third-party tracking domain if detected
  }));
  
  console.table ? console.table(displayRows) : console.log(JSON.stringify(displayRows, null, 2));

  // --- Compare HTTP Set-Cookie headers captured via CDP vs. browser-stored cookies
  function parseSetCookie(line) {
    // Returns { name, value, attrs: { Secure, HttpOnly, SameSite, Domain, Path, Expires } }
    const parts = line.split(';').map(p => p.trim());
    const [nameValue, ...attrs] = parts;
    const eq = nameValue.indexOf('=');
    const name = eq === -1 ? nameValue : nameValue.slice(0, eq).trim();
    const value = eq === -1 ? '' : nameValue.slice(eq + 1).trim();
    const attrsObj = {};
    for (const a of attrs) {
      const [k, ...rest] = a.split('=');
      const key = k.trim().toLowerCase();
      const val = rest.join('=').trim();
      if (key === 'secure') attrsObj.Secure = true;
      else if (key === 'httponly') attrsObj.HttpOnly = true;
      else if (key === 'samesite') attrsObj.SameSite = val || true;
      else if (key === 'domain') attrsObj.Domain = val;
      else if (key === 'path') attrsObj.Path = val;
      else if (key === 'expires') attrsObj.Expires = val;
      else attrsObj[k] = val || true;
    }
    return { name, value, attrs: attrsObj };
  }

  await browser.close();
})();
