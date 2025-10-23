const db = require('./db');

class CookiePatterns {
  constructor() {
    this.initTable();
  }

  initTable() {
    const createPatternsTable = `
      CREATE TABLE IF NOT EXISTS cookie_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_name TEXT NOT NULL,
        cookie_pattern TEXT NOT NULL,
        match_type TEXT NOT NULL CHECK(match_type IN ('starts_with', 'ends_with', 'contains', 'equals', 'regex')),
        root_domain TEXT NOT NULL,
        score_bonus REAL DEFAULT 0,
        confidence_level TEXT DEFAULT 'medium' CHECK(confidence_level IN ('low', 'medium', 'high')),
        description TEXT,
        active BOOLEAN DEFAULT TRUE,
        case_sensitive BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(cookie_pattern, match_type, root_domain)
      )
    `;

    db.db.run(createPatternsTable, (err) => {
      if (err) {
        console.error('Error creating cookie_patterns table:', err.message);
      } else {
        console.log('📋 Cookie patterns table initialized');
        this.addCaseSensitiveColumn();
      }
    });
  }

  addCaseSensitiveColumn() {
    // Add case_sensitive column if it doesn't exist
    db.db.run(`ALTER TABLE cookie_patterns ADD COLUMN case_sensitive BOOLEAN DEFAULT FALSE`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding case_sensitive column:', err.message);
      } else if (!err) {
        console.log('✅ Added case_sensitive column to cookie_patterns table');
      }
      this.seedDefaultPatterns();
    });
  }

  seedDefaultPatterns() {
    // Check if patterns already exist
    db.db.get('SELECT COUNT(*) as count FROM cookie_patterns', (err, row) => {
      if (err || row.count > 0) return;

      console.log('🌱 Seeding default cookie patterns...');

      const defaultPatterns = [
        // Cloudflare
        { name: 'Cloudflare CF', pattern: '_cf', type: 'starts_with', domain: 'cloudflare.com', bonus: 2, confidence: 'high', description: 'Cloudflare security and performance cookies' },
        { name: 'Cloudflare Ray', pattern: '__cf_bm', type: 'equals', domain: 'cloudflare.com', bonus: 2, confidence: 'high', description: 'Cloudflare bot management' },
        { name: 'Cloudflare Clearance', pattern: 'cf_clearance', type: 'equals', domain: 'cloudflare.com', bonus: 1, confidence: 'high', description: 'Cloudflare security clearance' },

        // AWS & Load Balancers
        { name: 'AWS ALB CORS', pattern: 'AWSALBCORS', type: 'equals', domain: 'amazonaws.com', bonus: 1, confidence: 'medium', description: 'AWS Application Load Balancer CORS' },
        { name: 'AWS ALB', pattern: 'AWSALB', type: 'starts_with', domain: 'amazonaws.com', bonus: 1, confidence: 'medium', description: 'AWS Application Load Balancer' },

        // Google Analytics & Ads
        { name: 'Google Analytics', pattern: '_ga', type: 'starts_with', domain: 'google.com', bonus: 3, confidence: 'high', description: 'Google Analytics tracking cookies' },
        { name: 'Google Analytics Throttle', pattern: '_gat', type: 'starts_with', domain: 'google.com', bonus: 2, confidence: 'high', description: 'Google Analytics request throttling' },
        { name: 'Google Ads', pattern: '_gcl', type: 'starts_with', domain: 'google.com', bonus: 3, confidence: 'high', description: 'Google Click Identifier for ads' },
        { name: 'Google Tag Manager', pattern: '_gtm', type: 'starts_with', domain: 'google.com', bonus: 2, confidence: 'high', description: 'Google Tag Manager cookies' },
        { name: 'Google Test Cookie', pattern: 'test_cookie', type: 'equals', domain: 'google.com', bonus: 1, confidence: 'medium', description: 'Google test cookie for ad serving' },
        { name: 'Google IDE', pattern: 'IDE', type: 'equals', domain: 'doubleclick.net', bonus: 3, confidence: 'high', description: 'Google DoubleClick advertising identifier' },

        // Facebook/Meta
        { name: 'Facebook Pixel', pattern: '_fbp', type: 'equals', domain: 'facebook.com', bonus: 3, confidence: 'high', description: 'Facebook Pixel tracking' },
        { name: 'Facebook Click ID', pattern: '_fbc', type: 'equals', domain: 'facebook.com', bonus: 3, confidence: 'high', description: 'Facebook Click ID' },

        // Adobe
        { name: 'Adobe Analytics', pattern: 's_', type: 'starts_with', domain: 'adobe.com', bonus: 2, confidence: 'high', description: 'Adobe Analytics (Omniture) cookies' },
        { name: 'Adobe Demdex', pattern: 'demdex', type: 'contains', domain: 'adobe.com', bonus: 3, confidence: 'high', description: 'Adobe Audience Manager' },

        // Microsoft
        { name: 'Microsoft Clarity', pattern: '_clck', type: 'starts_with', domain: 'microsoft.com', bonus: 2, confidence: 'high', description: 'Microsoft Clarity analytics' },
        { name: 'Bing Ads', pattern: '_uet', type: 'starts_with', domain: 'microsoft.com', bonus: 2, confidence: 'high', description: 'Bing Universal Event Tracking' },
        { name: 'Microsoft User ID', pattern: 'MUID', type: 'equals', domain: 'microsoft.com', bonus: 2, confidence: 'high', description: 'Microsoft User Identifier' },
        { name: 'Microsoft MR', pattern: 'MR', type: 'equals', domain: 'microsoft.com', bonus: 1, confidence: 'medium', description: 'Microsoft advertising cookie' },

        // HubSpot
        { name: 'HubSpot Tracking', pattern: '__hs', type: 'starts_with', domain: 'hubspot.com', bonus: 2, confidence: 'high', description: 'HubSpot tracking cookies' },
        { name: 'HubSpot CTA', pattern: '__hstc', type: 'equals', domain: 'hubspot.com', bonus: 2, confidence: 'high', description: 'HubSpot main tracking cookie' },

        // Marketo
        { name: 'Marketo Munchkin', pattern: '_mkto', type: 'starts_with', domain: 'marketo.com', bonus: 2, confidence: 'high', description: 'Marketo Munchkin tracking' },

        // Hotjar
        { name: 'Hotjar', pattern: '_hj', type: 'starts_with', domain: 'hotjar.com', bonus: 2, confidence: 'high', description: 'Hotjar user behavior analytics' },

        // LinkedIn
        { name: 'LinkedIn Insight', pattern: '_li', type: 'starts_with', domain: 'linkedin.com', bonus: 2, confidence: 'high', description: 'LinkedIn Insight Tag' },
        { name: 'LinkedIn Analytics', pattern: 'AnalyticsSyncHistory', type: 'equals', domain: 'linkedin.com', bonus: 2, confidence: 'high', description: 'LinkedIn analytics sync' },
        { name: 'LinkedIn Browser', pattern: 'lidc', type: 'equals', domain: 'linkedin.com', bonus: 2, confidence: 'high', description: 'LinkedIn data center routing' },
        { name: 'LinkedIn Suggestions', pattern: 'li_sugr', type: 'equals', domain: 'linkedin.com', bonus: 2, confidence: 'high', description: 'LinkedIn suggestions and recommendations' },
        { name: 'LinkedIn Browser Cookie', pattern: 'bcookie', type: 'equals', domain: 'linkedin.com', bonus: 2, confidence: 'high', description: 'LinkedIn browser identification' },
        { name: 'LinkedIn Secure Browser', pattern: 'bscookie', type: 'equals', domain: 'linkedin.com', bonus: 2, confidence: 'high', description: 'LinkedIn secure browser identification' },
        { name: 'LinkedIn User Match', pattern: 'UserMatchHistory', type: 'equals', domain: 'linkedin.com', bonus: 2, confidence: 'high', description: 'LinkedIn user matching history' },

        // TikTok
        { name: 'TikTok Pixel', pattern: '_ttp', type: 'equals', domain: 'tiktok.com', bonus: 3, confidence: 'high', description: 'TikTok Pixel tracking' },

        // Twitter/X
        { name: 'Twitter Analytics', pattern: '_twitter_sess', type: 'equals', domain: 'twitter.com', bonus: 2, confidence: 'high', description: 'Twitter analytics session' },

        // Pinterest
        { name: 'Pinterest', pattern: '_pin_unauth', type: 'equals', domain: 'pinterest.com', bonus: 2, confidence: 'high', description: 'Pinterest unauthenticated tracking' },

        // Snapchat
        { name: 'Snapchat Pixel', pattern: '_scid', type: 'equals', domain: 'snapchat.com', bonus: 3, confidence: 'high', description: 'Snapchat Pixel tracking' },

        // YouTube/Google Video
        { name: 'YouTube', pattern: 'YSC', type: 'equals', domain: 'youtube.com', bonus: 2, confidence: 'high', description: 'YouTube session cookie' },
        { name: 'YouTube Visitor', pattern: 'VISITOR_INFO1_LIVE', type: 'equals', domain: 'youtube.com', bonus: 2, confidence: 'high', description: 'YouTube visitor information' },

        // Salesforce
        { name: 'Salesforce Pardot', pattern: 'pardot', type: 'contains', domain: 'salesforce.com', bonus: 2, confidence: 'high', description: 'Salesforce Pardot marketing automation' },

        // Survey & Feedback Tools
        { name: 'Qualtrics', pattern: 'QSI_', type: 'starts_with', domain: 'qualtrics.com', bonus: 2, confidence: 'high', description: 'Qualtrics survey and feedback' },

        // Session Recording & Heatmaps
        { name: 'ClickTale', pattern: 'WRUID', type: 'equals', domain: 'clicktale.net', bonus: 2, confidence: 'high', description: 'ClickTale session recording' },
        { name: 'Beusable', pattern: 'beusable', type: 'contains', domain: 'beusable.net', bonus: 2, confidence: 'high', description: 'Beusable user behavior analytics' },
        { name: 'Datadog RUM', pattern: '_dd_', type: 'starts_with', domain: 'datadoghq.com', bonus: 2, confidence: 'high', description: 'Datadog Real User Monitoring' },
        { name: 'Datadog Cookie Test', pattern: 'dd_cookie_test_', type: 'starts_with', domain: 'datadoghq.com', bonus: 1, confidence: 'medium', description: 'Datadog cookie functionality test' },

        // E-commerce Platforms
        { name: 'Demandware', pattern: 'dwac_', type: 'starts_with', domain: 'salesforce.com', bonus: 1, confidence: 'medium', description: 'Salesforce Commerce Cloud (Demandware)' },
        { name: 'Demandware Anonymous', pattern: 'dwanonymous_', type: 'starts_with', domain: 'salesforce.com', bonus: 1, confidence: 'medium', description: 'Salesforce Commerce Cloud anonymous tracking' },

        // Other Services
        { name: 'Affirm', pattern: 'affirm', type: 'contains', domain: 'affirm.com', bonus: 1, confidence: 'medium', description: 'Affirm payment service' },
        { name: 'Warmly', pattern: 'warmly_', type: 'starts_with', domain: 'warmly.ai', bonus: 1, confidence: 'medium', description: 'Warmly visitor identification' },
        { name: 'Zync UUID', pattern: 'zync-uuid', type: 'equals', domain: 'unknown', bonus: 1, confidence: 'low', description: 'Zync synchronization identifier' },
        { name: 'Criteo CQ', pattern: '__cq_', type: 'starts_with', domain: 'criteo.com', bonus: 3, confidence: 'high', description: 'Criteo advertising cookies' },
        { name: 'Criteo ID', pattern: 'cquid', type: 'equals', domain: 'criteo.com', bonus: 3, confidence: 'high', description: 'Criteo user identifier' },
        { name: 'RocketLane', pattern: 'rlas3', type: 'equals', domain: 'rlcdn.com', bonus: 2, confidence: 'high', description: 'RocketLane advertising' },
        { name: 'TrustArc Session', pattern: 'TAsessionID', type: 'equals', domain: 'trustarc.com', bonus: 1, confidence: 'high', description: 'TrustArc session identifier' },

        // Consent Management
        { name: 'OneTrust', pattern: 'OptanonConsent', type: 'equals', domain: 'onetrust.com', bonus: 1, confidence: 'medium', description: 'OneTrust consent management' },
        { name: 'TrustArc General', pattern: 'notice_', type: 'starts_with', domain: 'trustarc.com', bonus: 1, confidence: 'medium', description: 'TrustArc consent management' },
        { name: 'TrustArc Behavior', pattern: 'notice_behavior', type: 'equals', domain: 'trustarc.com', bonus: 1, confidence: 'high', description: 'TrustArc behavior tracking consent' },
        { name: 'TrustArc GDPR Prefs', pattern: 'notice_gdpr_prefs', type: 'equals', domain: 'trustarc.com', bonus: 1, confidence: 'high', description: 'TrustArc GDPR preferences' },
        { name: 'TrustArc Preferences', pattern: 'notice_preferences', type: 'equals', domain: 'trustarc.com', bonus: 1, confidence: 'high', description: 'TrustArc user preferences' },
        { name: 'TrustArc Cookie Privacy', pattern: 'cmapi_cookie_privacy', type: 'equals', domain: 'trustarc.com', bonus: 1, confidence: 'high', description: 'TrustArc cookie privacy API' },
        { name: 'TrustArc CMAPI', pattern: 'cmapi_', type: 'starts_with', domain: 'trustarc.com', bonus: 1, confidence: 'medium', description: 'TrustArc Consent Management API' },
        { name: 'Cookiebot', pattern: 'CookieConsent', type: 'equals', domain: 'cookiebot.com', bonus: 1, confidence: 'medium', description: 'Cookiebot consent management' },
        { name: 'Quantcast Choice', pattern: '__qca', type: 'equals', domain: 'quantcast.com', bonus: 1, confidence: 'medium', description: 'Quantcast Choice consent management' },
        { name: 'Didomi', pattern: 'didomi_token', type: 'equals', domain: 'didomi.io', bonus: 1, confidence: 'medium', description: 'Didomi consent management' },
        { name: 'Usercentrics', pattern: 'uc_', type: 'starts_with', domain: 'usercentrics.com', bonus: 1, confidence: 'medium', description: 'Usercentrics consent management' },

        // Advertising & Tracking Networks
        { name: 'The Trade Desk', pattern: 'TDID', type: 'equals', domain: 'adsrvr.org', bonus: 3, confidence: 'high', description: 'The Trade Desk advertising identifier' },
        { name: 'The Trade Desk CPM', pattern: 'TDCPM', type: 'equals', domain: 'adsrvr.org', bonus: 3, confidence: 'high', description: 'The Trade Desk CPM tracking' },
        { name: 'Adobe Demdex', pattern: 'demdex', type: 'equals', domain: 'adobe.com', bonus: 3, confidence: 'high', description: 'Adobe Audience Manager identifier' },
        { name: 'Adobe DPM', pattern: 'dpm', type: 'equals', domain: 'adobe.com', bonus: 2, confidence: 'high', description: 'Adobe data provider mapping' },
        { name: 'Rubicon Project', pattern: 'khaos', type: 'equals', domain: 'rubiconproject.com', bonus: 3, confidence: 'high', description: 'Rubicon Project advertising' },
        { name: 'Rubicon Audit', pattern: 'audit', type: 'equals', domain: 'rubiconproject.com', bonus: 2, confidence: 'high', description: 'Rubicon Project audit tracking' },
        { name: 'Casale Media', pattern: 'CMID', type: 'equals', domain: 'casalemedia.com', bonus: 3, confidence: 'high', description: 'Casale Media advertising identifier' },
        { name: 'Casale Media Pro', pattern: 'CMPRO', type: 'equals', domain: 'casalemedia.com', bonus: 2, confidence: 'high', description: 'Casale Media professional tracking' },
        { name: 'Casale Media PS', pattern: 'CMPS', type: 'equals', domain: 'casalemedia.com', bonus: 2, confidence: 'high', description: 'Casale Media pixel sync' },
        { name: 'AppNexus UUID', pattern: 'uuid2', type: 'equals', domain: 'adnxs.com', bonus: 3, confidence: 'high', description: 'AppNexus advertising identifier' },
        { name: 'Tapad UUID', pattern: 'tuuid', type: 'starts_with', domain: 'tapad.com', bonus: 3, confidence: 'high', description: 'Tapad cross-device tracking' },
        { name: 'Generic UUID', pattern: 'uuid', type: 'equals', domain: 'unknown', bonus: 1, confidence: 'low', description: 'Generic UUID identifier' },
        { name: 'Reddit UUID', pattern: '_rdt_uuid', type: 'equals', domain: 'reddit.com', bonus: 2, confidence: 'high', description: 'Reddit advertising pixel' },

        // E-commerce & Analytics
        { name: 'Shopify Analytics', pattern: '_shopify_', type: 'starts_with', domain: 'shopify.com', bonus: 2, confidence: 'high', description: 'Shopify e-commerce analytics' },
        { name: 'Mixpanel', pattern: 'mp_', type: 'starts_with', domain: 'mixpanel.com', bonus: 2, confidence: 'high', description: 'Mixpanel analytics tracking' },
        { name: 'Amplitude', pattern: 'amplitude_', type: 'starts_with', domain: 'amplitude.com', bonus: 2, confidence: 'high', description: 'Amplitude analytics' },
        { name: 'Segment Analytics', pattern: 'ajs_', type: 'starts_with', domain: 'segment.com', bonus: 2, confidence: 'high', description: 'Segment analytics.js cookies' },
        { name: 'Intercom', pattern: 'intercom-', type: 'starts_with', domain: 'intercom.io', bonus: 2, confidence: 'high', description: 'Intercom customer messaging' },
        { name: 'Zendesk Chat', pattern: '__zlcmid', type: 'equals', domain: 'zendesk.com', bonus: 1, confidence: 'medium', description: 'Zendesk Chat widget' },
        { name: 'VWO Testing', pattern: '_vwo_uuid', type: 'starts_with', domain: 'vwo.com', bonus: 2, confidence: 'high', description: 'Visual Website Optimizer A/B testing' },
        { name: 'Snowplow Analytics', pattern: '_sp_', type: 'starts_with', domain: 'snowplowanalytics.com', bonus: 2, confidence: 'high', description: 'Snowplow analytics tracking' },

        // Testing & Debugging
        { name: 'Cookie Test', pattern: 'cookietest', type: 'equals', domain: 'unknown', bonus: 0, confidence: 'low', description: 'Generic cookie functionality test' },
        { name: 'Debug Cookie', pattern: 'ar_debug', type: 'equals', domain: 'unknown', bonus: 0, confidence: 'low', description: 'Debug/development cookie' },
        { name: 'Adobe Alloy TLD', pattern: 'com.adobe.alloy.getTld', type: 'equals', domain: 'adobe.com', bonus: 1, confidence: 'medium', description: 'Adobe Alloy SDK TLD detection' },
        { name: 'TLD Test', pattern: '__tld__', type: 'equals', domain: 'unknown', bonus: 0, confidence: 'low', description: 'Top-level domain detection test' },
        { name: 'Cookie Deprecation', pattern: 'receive-cookie-deprecation', type: 'equals', domain: 'google.com', bonus: 1, confidence: 'medium', description: 'Google cookie deprecation testing' },
        { name: 'PerimeterX', pattern: 'pxrc', type: 'equals', domain: 'perimeterx.com', bonus: 2, confidence: 'high', description: 'PerimeterX bot protection' },

        // Session Management
        { name: 'PHP Session', pattern: 'PHPSESSID', type: 'equals', domain: 'unknown', bonus: 0, confidence: 'low', description: 'PHP session identifier' },
        { name: 'ASP.NET Session', pattern: 'ASP.NET_SessionId', type: 'equals', domain: 'unknown', bonus: 0, confidence: 'low', description: 'ASP.NET session identifier' },
        { name: 'JSP Session', pattern: 'JSESSIONID', type: 'equals', domain: 'unknown', bonus: 0, confidence: 'low', description: 'Java servlet session identifier' }
      ];

      const stmt = db.db.prepare(`
        INSERT INTO cookie_patterns (pattern_name, cookie_pattern, match_type, root_domain, score_bonus, confidence_level, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      defaultPatterns.forEach(pattern => {
        stmt.run([
          pattern.name,
          pattern.pattern,
          pattern.type,
          pattern.domain,
          pattern.bonus,
          pattern.confidence,
          pattern.description
        ]);
      });

      stmt.finalize();
      console.log(`✅ Seeded ${defaultPatterns.length} default cookie patterns`);
    });
  }

  // Get all patterns
  getAllPatterns() {
    return new Promise((resolve, reject) => {
      db.db.all(`
        SELECT * FROM cookie_patterns 
        WHERE active = TRUE 
        ORDER BY score_bonus DESC, pattern_name ASC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Add new pattern
  addPattern(patternData) {
    return new Promise((resolve, reject) => {
      const stmt = db.db.prepare(`
        INSERT INTO cookie_patterns (
          pattern_name, cookie_pattern, match_type, root_domain, 
          score_bonus, confidence_level, description, active, case_sensitive
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        patternData.name,
        patternData.pattern,
        patternData.matchType,
        patternData.rootDomain,
        patternData.scoreBonus || 0,
        patternData.confidenceLevel || 'medium',
        patternData.description || '',
        patternData.active !== false,
        patternData.caseSensitive || false
      ], function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
      stmt.finalize();
    });
  }

  // Update pattern
  updatePattern(id, patternData) {
    return new Promise((resolve, reject) => {
      const stmt = db.db.prepare(`
        UPDATE cookie_patterns 
        SET pattern_name = ?, cookie_pattern = ?, match_type = ?, root_domain = ?,
            score_bonus = ?, confidence_level = ?, description = ?, active = ?, case_sensitive = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      stmt.run([
        patternData.name,
        patternData.pattern,
        patternData.matchType,
        patternData.rootDomain,
        patternData.scoreBonus || 0,
        patternData.confidenceLevel || 'medium',
        patternData.description || '',
        patternData.active !== false,
        patternData.caseSensitive || false,
        id
      ], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      stmt.finalize();
    });
  }

  // Delete pattern
  deletePattern(id) {
    return new Promise((resolve, reject) => {
      const stmt = db.db.prepare(`DELETE FROM cookie_patterns WHERE id = ?`);
      stmt.run([id], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      stmt.finalize();
    });
  }

  // Toggle pattern active status
  togglePattern(id, active) {
    return new Promise((resolve, reject) => {
      const stmt = db.db.prepare(`
        UPDATE cookie_patterns 
        SET active = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      stmt.run([active, id], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      stmt.finalize();
    });
  }

  // Match cookie name against patterns
  matchCookiePatterns(cookieName) {
    return new Promise((resolve, reject) => {
      this.getAllPatterns().then(patterns => {
        const matches = [];

        for (const pattern of patterns) {
          let isMatch = false;

          // Prepare comparison values based on case sensitivity
          const patternValue = pattern.case_sensitive ? pattern.cookie_pattern : pattern.cookie_pattern.toLowerCase();
          const cookieValue = pattern.case_sensitive ? cookieName : cookieName.toLowerCase();

          switch (pattern.match_type) {
            case 'starts_with':
              isMatch = cookieValue.startsWith(patternValue);
              break;
            case 'ends_with':
              isMatch = cookieValue.endsWith(patternValue);
              break;
            case 'contains':
              isMatch = cookieValue.includes(patternValue);
              break;
            case 'equals':
              isMatch = cookieValue === patternValue;
              break;
            case 'regex':
              try {
                const flags = pattern.case_sensitive ? '' : 'i';
                const regex = new RegExp(pattern.cookie_pattern, flags);
                isMatch = regex.test(cookieName);
              } catch (e) {
                console.warn(`Invalid regex pattern: ${pattern.cookie_pattern}`);
                isMatch = false;
              }
              break;
          }

          if (isMatch) {
            matches.push(pattern);
          }
        }

        resolve(matches);
      }).catch(reject);
    });
  }

  // Get pattern by ID
  getPattern(id) {
    return new Promise((resolve, reject) => {
      db.db.get(`SELECT * FROM cookie_patterns WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
}

module.exports = new CookiePatterns();