const express = require('express');
const db = require('../database/db');

const router = express.Router();

// Get scan results (legacy endpoint - for backward compatibility)
router.get('/scan/:scanId', async (req, res) => {
  try {
    const { scanId } = req.params;
    
    const scan = await db.getScan(scanId);
    if (!scan) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    // For legacy compatibility, try to get cookies by website URL
    const cookies = await db.getCookiesByWebsite(scan.url);
    
    res.json({
      scan,
      cookies,
      summary: {
        total: cookies.length,
        thirdParty: cookies.filter(c => c.third_party).length,
        firstParty: cookies.filter(c => !c.third_party).length,
        bySource: {
          javascript: cookies.filter(c => c.source === 'javascript').length,
          http: cookies.filter(c => c.source === 'http').length,
          browser: cookies.filter(c => c.source === 'browser').length
        }
      }
    });

  } catch (error) {
    console.error('Error getting scan results:', error);
    res.status(500).json({ error: 'Failed to get scan results' });
  }
});

// Get cookies by website URL
router.get('/website', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    const cookies = await db.getCookiesByWebsite(url);
    const scanHistory = await db.getScanHistory(url);
    
    res.json({
      website: url,
      scanHistory,
      cookies,
      summary: {
        total: cookies.length,
        thirdParty: cookies.filter(c => c.third_party).length,
        firstParty: cookies.filter(c => !c.third_party).length,
        bySource: {
          javascript: cookies.filter(c => c.source === 'javascript').length,
          http: cookies.filter(c => c.source === 'http').length,
          browser: cookies.filter(c => c.source === 'browser').length
        },
        byOriginDomain: cookies.reduce((acc, cookie) => {
          const domain = cookie.origin_domain || 'unknown';
          acc[domain] = (acc[domain] || 0) + 1;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    console.error('Error getting website results:', error);
    res.status(500).json({ error: 'Failed to get website results' });
  }
});

// Get cookies by origin domain
router.get('/origin-domain', async (req, res) => {
  try {
    const { domain } = req.query;
    
    if (!domain) {
      return res.status(400).json({ error: 'Domain parameter is required' });
    }

    const cookies = await db.getCookiesByOriginDomain(domain);
    
    res.json({
      originDomain: domain,
      cookies,
      summary: {
        total: cookies.length,
        thirdParty: cookies.filter(c => c.third_party).length,
        firstParty: cookies.filter(c => !c.third_party).length,
        websites: [...new Set(cookies.map(c => c.website))],
        cookieNames: [...new Set(cookies.map(c => c.cookie_name))]
      }
    });

  } catch (error) {
    console.error('Error getting origin domain results:', error);
    res.status(500).json({ error: 'Failed to get origin domain results' });
  }
});

// Get tracker statistics
router.get('/trackers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const trackers = await db.getTopTrackers(limit);
    res.json(trackers);
  } catch (error) {
    console.error('Error getting trackers:', error);
    res.status(500).json({ error: 'Failed to get trackers' });
  }
});

// Get all cookies with pagination
router.get('/all', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1000;
    const offset = parseInt(req.query.offset) || 0;
    
    const cookies = await db.getAllCookies(limit, offset);
    
    res.json({
      cookies,
      summary: {
        total: cookies.length,
        thirdParty: cookies.filter(c => c.third_party).length,
        firstParty: cookies.filter(c => !c.third_party).length,
        bySource: {
          javascript: cookies.filter(c => c.source === 'javascript').length,
          http: cookies.filter(c => c.source === 'http').length,
          browser: cookies.filter(c => c.source === 'browser').length
        },
        uniqueWebsites: [...new Set(cookies.map(c => c.website))].length,
        uniqueOriginDomains: [...new Set(cookies.filter(c => c.origin_domain).map(c => c.origin_domain))].length
      }
    });

  } catch (error) {
    console.error('Error getting all cookies:', error);
    res.status(500).json({ error: 'Failed to get all cookies' });
  }
});

// Get analytics dashboard data
router.get('/analytics', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

module.exports = router;