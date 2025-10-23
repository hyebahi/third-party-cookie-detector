const { chromium } = require('playwright');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const cookiePatterns = require('../database/cookiePatterns');
const fs = require('fs');

class CookieScanner {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async initialize() {
    // Enhanced browser launch options similar to console-scanner.js
    const useChrome = String(process.env.PLAYWRIGHT_USE_CHROME || '').toLowerCase() === 'true';
    const chromePathEnv = process.env.PLAYWRIGHT_CHROME_PATH || '';
    let launchOpts = {
      headless: false,
      args: [
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--allow-running-insecure-content',
        '--disable-blink-features=AutomationControlled'
      ]
    };

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

      const found = candidates.find(p => p && fs.existsSync(p));
      if (found) {
        launchOpts.executablePath = found;
        console.log('Launching system Chrome at:', found);
      } else if (chromePathEnv) {
        console.warn('PLAYWRIGHT_CHROME_PATH was provided but path not found:', chromePathEnv);
      } else {
        console.warn('PLAYWRIGHT_USE_CHROME=true but no Chrome binary found in common locations; using bundled Chromium');
      }
    }

    this.browser = await chromium.launch(launchOpts);

    // Enhanced user agent handling with more realistic UA
    const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    let userAgent = process.env.PLAYWRIGHT_USER_AGENT || DEFAULT_UA;
    if (userAgent && (userAgent.toLowerCase() === 'chrome' || userAgent.toLowerCase() === 'google-chrome')) {
      userAgent = DEFAULT_UA;
    }

    // Create context with minimal settings to match standalone script
    this.context = await this.browser.newContext({
      userAgent,
      ignoreHTTPSErrors: true,
      bypassCSP: true
    });

    this.page = await this.context.newPage();

    // Add stealth JavaScript to mask automation
    await this.page.addInitScript(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Mock chrome object
      window.chrome = {
        runtime: {},
        loadTimes: function () { },
        csi: function () { },
        app: {}
      };

      // Mock plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Mock permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // Mock screen properties
      Object.defineProperty(screen, 'availHeight', { get: () => 738 });
      Object.defineProperty(screen, 'availWidth', { get: () => 1366 });
      Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
      Object.defineProperty(screen, 'height', { get: () => 768 });
      Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
      Object.defineProperty(screen, 'width', { get: () => 1366 });
    });
  }

  /** ---------- Helpers ---------- */
  topFrameFromStack(stack = '') {
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

  extractCookieNameValue(input) {
    const first = (input || '').split(';', 1)[0];
    const eq = first.indexOf('=');
    if (eq === -1) return { name: first.trim(), value: '' };
    return { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
  }

  valuePreview(value, max = 60) {
    return value.length <= max ? value : value.slice(0, max) + '…';
  }

  /** Try to derive a friendly label (GTM, Adobe, Tealium, Segment) from a stack. */
  labelFromStack(stack) {
    // Google Tag Manager
    const gtm = stack.match(/googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/i);
    if (gtm) return gtm[1];

    // Adobe Launch (and legacy DTM)
    const ad1 = stack.match(/assets\.adobedtm\.com\/(launch-[A-Za-z0-9-_.]+)/i);
    if (ad1) return `AdobeLaunch:${ad1[1]}`;
    const ad2 = stack.match(/assets\.adobedtm\.com\/.*\/(satelliteLib-[A-Za-z0-9-_.]+)/i);
    if (ad2) return `AdobeDTM:${ad2[1]}`;

    // Tealium iQ
    const tl = stack.match(/tags\.tiqcdn\.com\/utag\/([^/]+)\/([^/]+)\/([^/]+)\/utag/i);
    if (tl) return `Tealium:${tl[1]}/${tl[2]}/${tl[3]}`;

    // Segment
    const seg = stack.match(/cdn\.segment\.com\/analytics\.js\/v1\/([^/]+)\//i);
    if (seg) return `Segment:${seg[1]}`;

    return null;
  }

  /** ---------- Pattern-based third-party detection ---------- */
  async getThirdPartyDomainFromPatterns(cookieName) {
    try {
      const matchedPatterns = await cookiePatterns.matchCookiePatterns(cookieName);
      if (matchedPatterns.length > 0) {
        // Use the highest scoring pattern for third-party determination
        const bestPattern = matchedPatterns.reduce((best, current) =>
          current.score_bonus > best.score_bonus ? current : best
        );

        // If the pattern has a root domain that's not 'unknown', it's third-party
        if (bestPattern.root_domain && bestPattern.root_domain !== 'unknown') {
          return bestPattern.root_domain;
        }
      }
    } catch (error) {
      console.warn(`Error checking patterns for ${cookieName}:`, error.message);
    }
    return null;
  }

  /** ---------- Third-party service detection ---------- */
  detectThirdPartyServices(networkRequests) {
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
  async scanWebsite(url) {
    const scanId = uuidv4();
    const startTime = Date.now();

    try {
      console.log(`🔍 Starting scan for: ${url}`);

      // Always initialize a fresh browser for each scan to avoid state issues
      if (this.browser) {
        await this.cleanup();
      }
      await this.initialize();

      // Store scan record
      await db.createScan(scanId, url, 'running');

      // Set TrustArc cookies before navigation (from original index.js)
      console.log('Setting TrustArc cookies...');
      const targetUrl = new URL(url);
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
          await this.context.addCookies([cookie]);
          console.log(`Set cookie: ${cookie.name}=${cookie.value} for domain ${cookie.domain}`);
        } catch (e) {
          console.warn(`Failed to set cookie ${cookie.name}:`, e.message);
        }
      }

      const results = await this.performScan(url);

      // Store results in database
      for (const cookie of results.cookies) {
        await db.storeCookie(url, cookie);
      }

      // Update scan history for optimization
      await db.updateScanHistory(url);

      const duration = Date.now() - startTime;
      await db.updateScan(scanId, 'completed', results.cookies.length, duration);

      console.log(`✅ Scan completed: ${results.cookies.length} cookies found in ${duration}ms`);

      return {
        scanId,
        url,
        status: 'completed',
        cookieCount: results.cookies.length,
        duration,
        cookies: results.cookies
      };

    } catch (error) {
      console.error(`❌ Scan failed for ${url}:`, error.message);

      const duration = Date.now() - startTime;
      await db.updateScan(scanId, 'failed', 0, duration, error.message);

      throw error;
    }
  }

  async performScan(url) {
    // EXACT LOGIC FROM WORKING INDEX.JS

    /** ---------- CDP hookup for HTTP Set-Cookie initiators ---------- */
    const cdp = await this.context.newCDPSession(this.page);
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
    const networkRequests = []; // Store all network requests for third-party detection

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

      if (requestCount % 10 === 0) {
        console.log(`[CDP] Processed ${requestCount} requests`);
      }
    });

    const httpEvents = []; // {url, setCookie[], initiator, ts}
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
      const pageUrl = new URL(this.page.url());
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
    await this.page.addInitScript(this.getInstrumentationScript());

    // Navigate with robust error handling
    await this.robustGoto(url);
    await this.page.waitForTimeout(2000); // Wait a bit longer for initial scripts to load

    // Log the effective user agent from the page for debugging
    try {
      const seenUa = await this.page.evaluate(() => navigator.userAgent);
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
    await this.page.waitForTimeout(5000);

    // Grab the instrumentation data from the page
    let cookieCreationStacks = {};
    try {
      const resPost = await this.page.evaluate(() => {
        if (!window.__cookieMvp) return null;
        return {
          jsLogs: window.__cookieMvp.jsLogs || [],
          scriptGraph: window.__cookieMvp.scriptGraph || {},
          containerLabels: Array.from(window.__cookieMvp.containerLabels || []),
          cookieCreationStacks: Object.fromEntries(window.__cookieMvp.cookieCreationStacks || new Map()),
        };
      });
      if (resPost) {
        jsLogs = resPost.jsLogs || [];
        scriptGraph = resPost.scriptGraph || {};
        containerLabels = resPost.containerLabels || [];
        cookieCreationStacks = resPost.cookieCreationStacks || {};

        console.log(`Captured ${jsLogs.length} JS cookie operations and ${httpEvents.length} HTTP Set-Cookie events`);
        console.log(`[CDP Summary] Processed ${responseCount} responses (${crossOriginResponses} cross-origin), found ${setCookieCount} with Set-Cookie headers`);
        console.log(`[Origin Analysis] Analyzed ${Object.keys(cookieCreationStacks).length} cookie creation origins`);

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
      const actualCookies = await this.context.cookies();
      console.log(`[CDP Synthetic] Found ${actualCookies.length} total cookies in browser storage`);

      // Build set of cookies we already captured via network or JS
      const capturedCookieNames = new Set();

      // Add cookies captured via HTTP Set-Cookie headers
      httpEvents.forEach(evt => {
        evt.setCookie.forEach(sc => {
          const { name } = this.extractCookieNameValue(sc);
          capturedCookieNames.add(name);
        });
      });

      // Add cookies captured via JS instrumentation (check all JS operations, not just document.cookie)
      jsLogs.forEach(log => {
        // Extract cookie name from various JS operation types
        let cookieName = null;

        if (log.via === 'document.cookie') {
          const { name } = this.extractCookieNameValue(log.payload);
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
    }

    // Quick cookie count check before building the final table
    try {
      const quickCheck = await this.context.cookies();
      console.log(`Browser has ${quickCheck.length} cookies in storage before building final table`);
    } catch (e) {
      console.warn('Could not check cookie count:', e && e.message);
    }

    const browserCookies = await this.context.cookies();

    return await this.processResults(url, jsLogs, httpEvents, browserCookies, networkRequests, scriptGraph, cookieCreationStacks);
  }

  async robustGoto(url) {
    // Single quick attempt: user requested only one attempt with a reduced timeout
    const attempts = [
      { waitUntil: 'domcontentloaded', timeout: 15000 },
    ];

    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const opts = attempts[i];
      try {
        console.log(`Attempt ${i + 1}/${attempts.length}: goto ${url} (waitUntil=${opts.waitUntil}, timeout=${opts.timeout}ms)`);
        await this.page.goto(url, opts);
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

  async processResults(url, jsLogs, httpEvents, browserCookies, networkRequests, scriptGraph, cookieCreationStacks) {

    const cookies = [];
    const cookieFirstSeen = new Map(); // Track first occurrence of each cookie
    const cookieLatestValue = new Map(); // Track latest value for each cookie

    // Detect third-party services using network request analysis
    const thirdPartyDetections = this.detectThirdPartyServices(networkRequests);
    console.log(`[Third-Party Detection] Found ${thirdPartyDetections.size} third-party service scripts`);

    // Log all detections
    thirdPartyDetections.forEach((trackingDomain, scriptUrl) => {
      console.log(`[Third-Party Service] ${scriptUrl} → ${trackingDomain}`);
    });

    // Helper function to get third-party tracking domain for an origin
    // EXACT LOGIC FROM INDEX.JS - only return network-detected third-party services
    const getThirdPartyDomain = (origin) => {
      if (!origin || origin === 'inline/unknown') return null;

      // Extract the base URL from stack traces (remove line:column)
      // For stack traces like "https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js:1:33585"
      // We want to extract "https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js"
      let cleanOrigin = origin;

      // Remove line:column numbers from stack traces
      const stackMatch = origin.match(/^(https?:\/\/[^:]+(?::\d+)?\/[^:]*?)(?::\d+:\d+)?$/);
      if (stackMatch) {
        cleanOrigin = stackMatch[1];
      }

      // Check if this origin matches any detected third-party script
      for (const [scriptUrl, trackingDomain] of thirdPartyDetections) {
        // Try exact match first
        if (cleanOrigin === scriptUrl) {
          return trackingDomain;
        }

        // Try partial matches
        if (cleanOrigin.includes(scriptUrl) || scriptUrl.includes(cleanOrigin)) {
          return trackingDomain;
        }

        // Try matching just the path part for cases where domains match
        try {
          const originUrl = new URL(cleanOrigin);
          const scriptUrlObj = new URL(scriptUrl);

          if (originUrl.hostname === scriptUrlObj.hostname &&
            originUrl.pathname === scriptUrlObj.pathname) {
            return trackingDomain;
          }
        } catch (e) {
          // Continue if URL parsing fails
        }
      }



      // CRITICAL: Only return third-party domains detected via network analysis
      // This preserves cases like:
      // - Cookie from info.trustarc.com with origin 846-llz-652.mktoresp.com
      // - The thirdPartyDomain should be 846-llz-652.mktoresp.com (the actual service)
      // - NOT info.trustarc.com (just the cookie domain)
      return null;
    };

    // Build a priority map: JS operations take precedence over HTTP synthetic events
    const jsCookieNames = new Set();

    // First pass: collect all JS cookie names
    for (let i = 0; i < jsLogs.length; i++) {
      const log = jsLogs[i];
      if (log.via === 'document.cookie') {
        const { name } = this.extractCookieNameValue(log.payload);
        if (name) {
          if (name.includes('notice_') || name.includes('cmapi_')) {
            console.log(`[Attribution Debug] Operation ${i}: JS cookie: ${name} from payload: ${log.payload.substring(0, 100)}`);
          }
          jsCookieNames.add(name);
        } else {
          console.log(`[Attribution Debug] Operation ${i}: Failed to extract name from payload: ${log.payload.substring(0, 80)}...`);
        }
      } else if (log.via === 'cookieStore.set') {
        const { name } = this.extractCookieNameValue(log.payload);
        if (name) jsCookieNames.add(name);
      }
    }

    console.log(`[Attribution] JS operations detected for cookies: ${Array.from(jsCookieNames).join(', ')}`);
    console.log(`[Attribution Debug] Total jsLogs processed: ${jsLogs.length}, unique cookie names: ${jsCookieNames.size}`);

    // JS-set cookies (EXACT LOGIC FROM INDEX.JS)
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
        stackTop = this.topFrameFromStack(stackToUse);
        stackUrlOnly = stackTop.split(':').slice(0, -2).join(':') || stackTop;
      }

      let parent = scriptGraph[stackUrlOnly] || scriptGraph[stackTop] || null;
      if (!parent) {
        const lbl = (stackToUse && this.labelFromStack(stackToUse));
        if (lbl) parent = lbl;
      }

      // Show the original script that created the cookie (clean, simple attribution)
      const origin = stackTop;

      if (via === 'document.cookie') {
        const { name, value } = this.extractCookieNameValue(payload);

        // Track the latest value for this cookie
        cookieLatestValue.set(name, value);

        // Only add row if this is the first time we see this cookie name
        if (!cookieFirstSeen.has(name)) {
          let thirdPartyDomain = getThirdPartyDomain(origin);
          let isThirdParty = !!thirdPartyDomain;

          // Pattern-based third-party detection
          if (!thirdPartyDomain) {
            thirdPartyDomain = await this.getThirdPartyDomainFromPatterns(name);
            isThirdParty = !!thirdPartyDomain;
          }

          // Domain-based fallback for JS cookies
          if (!thirdPartyDomain && origin && origin !== 'inline/unknown') {
            try {
              const originUrl = new URL(origin.split(':').slice(0, -2).join(':') || origin);
              const originDomain = originUrl.hostname;
              const mainDomain = new URL(url).hostname;

              // Remove 'www.' prefix for comparison
              const cleanOriginDomain = originDomain.replace(/^www\./, '');
              const cleanMainDomain = mainDomain.replace(/^www\./, '');

              // If domains are different, it's third-party
              if (cleanOriginDomain !== cleanMainDomain) {
                thirdPartyDomain = originDomain;
                isThirdParty = true;
              }
            } catch (e) {
              // If URL parsing fails, continue without third-party detection
            }
          }

          cookieFirstSeen.set(name, { source: 'JS', origin, via });
          cookies.push({
            name,
            value: this.valuePreview(value), // Will be updated later with latest value
            source: 'javascript',
            origin,
            thirdParty: isThirdParty,
            thirdPartyDomain: thirdPartyDomain || null,
            timestamp: log.ts || Date.now()
          });

          console.log(`[JS Cookie Debug] Added cookie with finalThirdPartyDomain: ${finalThirdPartyDomain || null}`);
        }
      } else {
        // Handle cookieStore.set and other operations
        if (via === 'cookieStore.set') {
          // Try to extract cookie name from cookieStore.set
          const { name, value } = this.extractCookieNameValue(payload);
          if (name) {
            // Track the latest value for this cookie
            cookieLatestValue.set(name, value);

            // Only add row if this is the first time we see this cookie name
            if (!cookieFirstSeen.has(name)) {
              let thirdPartyDomain = getThirdPartyDomain(origin);
              let isThirdParty = !!thirdPartyDomain;

              // Pattern-based third-party detection
              if (!thirdPartyDomain) {
                thirdPartyDomain = await this.getThirdPartyDomainFromPatterns(name);
                isThirdParty = !!thirdPartyDomain;
              }

              cookieFirstSeen.set(name, { source: 'JS', origin, via });
              cookies.push({
                name,
                value: this.valuePreview(value),
                source: 'javascript',
                origin,
                thirdParty: isThirdParty,
                thirdPartyDomain: thirdPartyDomain || null,
                timestamp: log.ts || Date.now()
              });
            }
          } else {
            // Fallback for unparseable cookieStore.set
            const thirdPartyDomain = getThirdPartyDomain(origin);
            cookies.push({
              name: '(cookieStore.set - unparseable)',
              value: String(payload).slice(0, 60) + '…',
              source: 'javascript',
              origin,
              thirdParty: !!thirdPartyDomain,
              thirdPartyDomain: thirdPartyDomain || null,
              timestamp: log.ts || Date.now()
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
              let thirdPartyDomain = getThirdPartyDomain(origin);
              let isThirdParty = !!thirdPartyDomain;

              // Pattern-based third-party detection
              if (!thirdPartyDomain) {
                thirdPartyDomain = await this.getThirdPartyDomainFromPatterns(cookieName);
                isThirdParty = !!thirdPartyDomain;
              }

              cookieFirstSeen.set(cookieName, { source: 'JS', origin, via });
              cookies.push({
                name: cookieName,
                value: this.valuePreview(cookieValue || ''),
                source: 'javascript',
                origin,
                thirdParty: isThirdParty,
                thirdPartyDomain: thirdPartyDomain || null,
                timestamp: log.ts || Date.now()
              });
            }
          }
          // If we can't extract a cookie name, skip this operation (it's not a cookie operation)
        }
      }
    }

    // HTTP Set-Cookie (EXACT LOGIC FROM INDEX.JS)
    for (const evt of httpEvents) {
      for (const line of evt.setCookie) {
        const { name, value } = this.extractCookieNameValue(line);

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

          // IMPORTANT: Use the same third-party detection logic as JS cookies
          // This ensures we don't override network-detected third-party services
          // with simple domain comparison
          const thirdPartyDomain = getThirdPartyDomain(origin);

          // Fallback: if no third-party service detected via network analysis,
          // check if response domain differs from main domain
          let fallbackThirdPartyDomain = null;
          let isThirdParty = !!thirdPartyDomain;

          if (!thirdPartyDomain) {
            try {
              const responseUrl = evt.url;
              const responseDomain = new URL(responseUrl).hostname;
              const mainDomain = new URL(url).hostname;

              // Remove 'www.' prefix for comparison
              const cleanResponseDomain = responseDomain.replace(/^www\./, '');
              const cleanMainDomain = mainDomain.replace(/^www\./, '');

              // If domains are different, it's third-party (fallback only)
              if (cleanResponseDomain !== cleanMainDomain) {
                fallbackThirdPartyDomain = responseDomain;
                isThirdParty = true;
              }
            } catch (e) {
              console.warn(`[HTTP Cookie] Could not parse domains for ${evt.url}:`, e.message);
            }
          }

          cookieFirstSeen.set(name, { source: 'HTTP', origin, via: 'HTTP Set-Cookie' });
          cookies.push({
            name,
            value: this.valuePreview(value), // Will be updated later with latest value
            source: 'http',
            origin,
            thirdParty: isThirdParty,
            thirdPartyDomain: thirdPartyDomain || fallbackThirdPartyDomain,
            timestamp: evt.ts || Date.now()
          });
        }
      }
    }

    // Merge browser-stored cookies (EXACT LOGIC FROM INDEX.JS)
    try {
      const stored = browserCookies;

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
              const kv = this.extractCookieNameValue(log.payload || '');
              if (kv.name === cookieName) {
                // Check if this log has origin analysis
                if (log.originAnalysis && log.originAnalysis.origin !== 'inline/unknown') {
                  return log.originAnalysis.origin;
                }
                // Fallback to stack analysis
                const top = this.topFrameFromStack(log.stack || '');
                if (top && top !== 'inline/unknown') return top;
              }
            }
          } catch { }
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
            } catch { }
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
          let thirdPartyDomain = getThirdPartyDomain(originStr);
          let isThirdParty = !!thirdPartyDomain;

          // Pattern-based third-party detection
          if (!thirdPartyDomain) {
            thirdPartyDomain = await this.getThirdPartyDomainFromPatterns(c.name);
            isThirdParty = !!thirdPartyDomain;
          }

          // Domain-based fallback for browser cookies
          if (!thirdPartyDomain && c.domain) {
            try {
              const cookieDomain = c.domain.replace(/^\./, '');
              const mainDomain = new URL(url).hostname;
              const cleanCookieDomain = cookieDomain.replace(/^www\./, '');
              const cleanMainDomain = mainDomain.replace(/^www\./, '');

              if (cleanCookieDomain !== cleanMainDomain) {
                thirdPartyDomain = cookieDomain;
                isThirdParty = true;
              }
            } catch (e) {
              // Continue without third-party detection if parsing fails
            }
          }

          cookieFirstSeen.set(c.name, { source: 'Browser', origin: originStr, via: 'context.cookies()' });
          cookies.push({
            name: c.name,
            value: this.valuePreview(c.value || ''),
            source: 'browser',
            origin: originStr,
            thirdParty: isThirdParty,
            thirdPartyDomain: thirdPartyDomain || null,
            timestamp: Date.now()
          });
        }
      }
    } catch (e) {
      console.warn('Could not read context.cookies() to merge into table:', e && e.message);
    }

    // Update all cookies with latest values from browser storage
    for (const cookie of cookies) {
      if (cookieLatestValue.has(cookie.name)) {
        cookie.value = this.valuePreview(cookieLatestValue.get(cookie.name));
      }
    }

    // Detection completeness analysis (EXACT LOGIC FROM INDEX.JS)
    try {
      const actualCookies = browserCookies;
      const capturedViaJS = jsLogs.length;
      const capturedViaHTTP = httpEvents.reduce((sum, evt) => sum + evt.setCookie.length, 0);
      const totalActualCookies = actualCookies.length;

      console.log('\n=== COOKIE DETECTION ANALYSIS ===');
      console.log(`🔍 Total cookies in browser: ${totalActualCookies}`);
      console.log(`📝 JS operations captured: ${capturedViaJS}`);
      console.log(`🌐 HTTP Set-Cookie captured: ${capturedViaHTTP}`);
      console.log(`📊 Rows in table: ${cookies.length}`);

      // Identify cookies that weren't detected during creation
      const detectedNames = new Set();
      jsLogs.forEach(log => {
        if (log.via === 'document.cookie') {
          const { name } = this.extractCookieNameValue(log.payload);
          detectedNames.add(name);
        }
      });
      httpEvents.forEach(evt => {
        evt.setCookie.forEach(sc => {
          const { name } = this.extractCookieNameValue(sc);
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

    console.log(`[ProcessResults Debug] Final cookies before return:`, cookies.map(c => ({
      name: c.name,
      source: c.source,
      thirdPartyDomain: c.thirdPartyDomain,
      origin: c.origin?.substring(0, 80) + '...'
    })));

    return { cookies };
  }

  getInstrumentationScript() {
    // Copy exact TAG_MANAGER_DETECTORS from original index.js
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
          } catch { } // eslint-disable-line
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
          } catch { }
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
          } catch { }
          return null;
        }
      }
    ];

    // Return the EXACT instrumentation script from index.js
    return `(function(detectorsSrc) {
      // Deserialize detectors on the page side
      const DETECTORS = new Map(detectorsSrc);

      // Enhanced shared store
      window.__cookieMvp = {
        jsLogs: [],
        scriptGraph: {},      // childScriptUrl -> parentLabelOrFrame
        containerLabels: new Set(), // detected TM labels
        initialCookies: new Set(), // Track cookies present at instrumentation time
        periodicSnapshots: [], // Periodic cookie snapshots to detect delayed creation
        cookieCreationStacks: new Map(), // cookieName -> detailed stack info
      };

      // Capture initial cookie state to compare against later
      try {
        const initialCookieNames = document.cookie.split(';')
          .map(c => c.trim().split('=')[0])
          .filter(n => n);
        initialCookieNames.forEach(name => window.__cookieMvp.initialCookies.add(name));
        console.log(\`[Cookie MVP] Initial cookies detected: \${initialCookieNames.length}\`);
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
        const stackLines = stack.split('\\n');
        
        // Find the first external script URL in the stack (excluding our wrapper code)
        for (let i = 1; i < stackLines.length; i++) {
          const line = stackLines[i];
          
          // Look for actual script URLs
          const urlMatch = line.match(/https?:\\/\\/[^\\s)]+/);
          if (urlMatch && !urlMatch[0].includes('<anonymous>')) {
            return {
              origin: urlMatch[0],
              reason: 'stack-trace-analysis',
              evidence: \`Found in stack: \${line.trim()}\`
            };
          }
          
          // Also check for eval contexts that might have origin info
          const evalMatch = line.match(/eval.*https?:\\/\\/[^\\s)]+/);
          if (evalMatch) {
            const evalUrl = evalMatch[0].match(/https?:\\/\\/[^\\s)]+/);
            if (evalUrl) {
              return {
                origin: evalUrl[0],
                reason: 'eval-context-analysis',
                evidence: \`Found in eval context: \${line.trim()}\`
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
        const stackFrames = stack.split('\\n').slice(1, 10); // Get more frames, skip Error constructor
        const enhancedStack = stackFrames.join('\\n');
        
        window.__cookieMvp.jsLogs.push({ 
          via, 
          payload: cookieOrArgs, 
          stack: enhancedStack, 
          originalStack: stack,
          ts: Date.now(),
          cookieName: cookieName,
          originAnalysis: originAnalysis,
          ...extraInfo
        });
        
        if (originAnalysis && originAnalysis.reason === 'stack-trace-analysis') {
          console.log(\`[Cookie MVP] \${cookieName} created by: \${originAnalysis.origin}\`);
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
              const stackLines = fullStack.split('\\n');
              
              // Find the first external script URL (not our wrapper, not eval, not anonymous)
              let actualCaller = 'inline/unknown';
              let callerScript = null;
              
              for (let i = 1; i < stackLines.length; i++) {
                const line = stackLines[i];
                // Look for actual script URLs
                const urlMatch = line.match(/https?:\\/\\/[^\\s)]+/);
                if (urlMatch && !urlMatch[0].includes('<anonymous>')) {
                  actualCaller = urlMatch[0];
                  callerScript = urlMatch[0].split('?')[0]; // Remove query params
                  break;
                }
                // Also check for eval contexts that might have origin info
                const evalMatch = line.match(/eval.*https?:\\/\\/[^\\s)]+/);
                if (evalMatch) {
                  const evalUrl = evalMatch[0].match(/https?:\\/\\/[^\\s)]+/);
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
              const cookieString = \`\${cookieInfo.name}=\${cookieInfo.value || ''}\`;
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

      // Enhanced cookie attribution - track resource loading for cookie attribution
      window.__cookieMvp.recentScripts = new Map(); // URL -> {timestamp, parentScript}
      window.__cookieMvp.recentIframes = new Map(); // URL -> {timestamp, parentScript}
      
      // Track script loading without recording as cookie events
      const originalAppendChild = Node.prototype.appendChild;
      Node.prototype.appendChild = function(child) {
        const stack = new Error().stack || '';
        const parentScript = (stack.match(/https?:\\/\\/[^\\s)]+:\\d+:\\d+/) || [])[0] || 'inline/unknown';
        
        if (child.nodeName === 'SCRIPT' && child.src) {
          window.__cookieMvp.recentScripts.set(child.src, {
            timestamp: Date.now(),
            parentScript: parentScript
          });
        } else if (child.nodeName === 'IFRAME' && child.src) {
          window.__cookieMvp.recentIframes.set(child.src, {
            timestamp: Date.now(),
            parentScript: parentScript
          });
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
                const parentScript = (stack.match(/https?:\\/\\/[^\\s)]+:\\d+:\\d+/) || [])[0] || 'inline/unknown';
                
                window.__cookieMvp.recentIframes.set(value, {
                  timestamp: Date.now(),
                  parentScript: parentScript
                });
                
                return originalSrcSetter.call(element, value);
              }
            });
          }
        }
        return element;
      };

      // Periodic cookie monitoring to detect changes not captured by direct instrumentation
      const takeSnapshot = () => {
        try {
          const currentCookies = document.cookie.split(';')
            .map(c => c.trim().split('=')[0])
            .filter(n => n);
          
          const newCookies = currentCookies.filter(name => !window.__cookieMvp.initialCookies.has(name));
          
          if (newCookies.length > 0) {
            recordJsCookie('periodic.detection', \`New cookies: \${newCookies.join(', ')}\`, {
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

      // Monitor for consent management API calls that might trigger cookie setting
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

      // Script parent → child attribution with label awareness (preserve existing logic)
      const originalCreateElement = Document.prototype.createElement;
      Document.prototype.createElement = function(tagName, options) {
        const el = originalCreateElement.call(this, tagName, options);
        if ((tagName || '').toLowerCase() === 'script') {
          let _src = '';
          const stackForThisScript = () => {
            const s = new Error().stack || '';
            const lbl = detectLabel(s);
            if (lbl) return lbl; // Prefer TM label
            const top = (s.match(/https?:\\/\\/[^\\s)]+:\\d+:\\d+/) || [])[0];
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

      // Optional: probe globals to pick up labels even if not in stack
      try {
        // Adobe
        if (window._satellite?.buildInfo) {
          const b = window._satellite.buildInfo;
          window.__cookieMvp.containerLabels.add(\`Adobe:\${b.environment || 'env?'}:\${b.name || 'lib'}\`);
        }
        // Tealium
        if (window.utag?.cfg) {
          const c = window.utag.cfg;
          window.__cookieMvp.containerLabels.add(\`Tealium:\${c.ac || '?'}/\${c.pr || '?'}/\${c.env || '?'}\`);
        }
        // Segment heuristic
        if (Array.isArray(window.analytics)) {
          window.__cookieMvp.containerLabels.add('Segment:(analytics array)');
        }
      } catch {}
    })(${JSON.stringify(TAG_MANAGER_DETECTORS.map(d => [d.name, { fromStack: d.fromStack?.toString?.() ? eval : null }]))});`;
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

module.exports = CookieScanner;