const express = require('express');
const CookieScoring = require('../services/cookieScoring');
const db = require('../database/db');

const router = express.Router();
const cookieScoring = new CookieScoring();

// Get scored cookies for a specific website
router.get('/website', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    const scoredData = await cookieScoring.scoreWebsiteCookies(url);
    
    res.json(scoredData);

  } catch (error) {
    console.error('Error getting scored website cookies:', error);
    res.status(500).json({ error: 'Failed to get scored cookies' });
  }
});

// Get global cookie statistics with scoring
router.get('/global', async (req, res) => {
  try {
    const globalStats = await cookieScoring.getGlobalCookieStats();
    
    res.json({
      cookies: globalStats,
      summary: {
        total: globalStats.length,
        highConfidence: globalStats.filter(c => c.scoring.confidence === 'high').length,
        mediumConfidence: globalStats.filter(c => c.scoring.confidence === 'medium').length,
        lowConfidence: globalStats.filter(c => c.scoring.confidence === 'low').length,
        thirdParty: globalStats.filter(c => c.thirdPartyRatio > 50).length,
        averageScore: globalStats.reduce((sum, c) => sum + c.scoring.score, 0) / globalStats.length
      }
    });

  } catch (error) {
    console.error('Error getting global cookie stats:', error);
    res.status(500).json({ error: 'Failed to get global cookie statistics' });
  }
});

// Get scoring details for a specific cookie
router.get('/cookie/:cookieName', async (req, res) => {
  try {
    const { cookieName } = req.params;
    
    // Get all instances of this cookie across websites
    const query = `
      SELECT 
        website,
        source,
        origin,
        origin_domain,
        third_party,
        third_party_domain,
        created_at,
        updated_at
      FROM cookies 
      WHERE cookie_name = ?
      ORDER BY updated_at DESC
    `;
    
    const instances = await new Promise((resolve, reject) => {
      db.db.all(query, [cookieName], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (instances.length === 0) {
      return res.status(404).json({ error: 'Cookie not found' });
    }

    // Calculate attribution first to get the primary origin
    // For third-party cookies, use third_party_domain as the attribution source
    const attribution = cookieScoring.calculateAttributionProbability(
      cookieName, 
      instances.map(i => ({ 
        origin: i.origin,
        thirdPartyDomain: i.third_party_domain,
        isThirdParty: i.third_party
      }))
    );

    // Calculate scoring for this cookie using the primary attributed origin
    const mockCookie = {
      name: cookieName,
      source: instances[0].source,
      third_party: instances[0].third_party,
      third_party_domain: instances[0].third_party_domain,
      origin: attribution.primaryOrigin || instances[0].origin
    };

    const scoring = cookieScoring.calculateCookieScore(mockCookie, { count: instances.length });
    
    // Override the originDomain with the primary attribution
    scoring.originDomain = attribution.primaryOrigin || cookieScoring.extractDomainFromOrigin(instances[0].origin) || 'unknown';

    // Group instances by website and origin
    const byWebsite = instances.reduce((acc, instance) => {
      if (!acc[instance.website]) {
        acc[instance.website] = [];
      }
      acc[instance.website].push(instance);
      return acc;
    }, {});

    const byOrigin = instances.reduce((acc, instance) => {
      // For third-party cookies, use third_party_domain; otherwise extract from origin
      let domain;
      if (instance.third_party && instance.third_party_domain) {
        domain = instance.third_party_domain;
      } else {
        domain = cookieScoring.extractDomainFromOrigin(instance.origin) || 'unknown';
      }
      
      if (!acc[domain]) {
        acc[domain] = [];
      }
      acc[domain].push(instance);
      return acc;
    }, {});

    res.json({
      cookieName,
      scoring,
      attribution,
      statistics: {
        totalInstances: instances.length,
        websiteCount: Object.keys(byWebsite).length,
        originCount: Object.keys(byOrigin).length,
        thirdPartyRatio: Math.round((instances.filter(i => i.third_party).length / instances.length) * 100)
      },
      instances: {
        byWebsite,
        byOrigin,
        recent: instances.slice(0, 10) // Most recent 10 instances
      }
    });

  } catch (error) {
    console.error('Error getting cookie scoring details:', error);
    res.status(500).json({ error: 'Failed to get cookie details' });
  }
});

// Get top tracking cookies by score
router.get('/top-trackers', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const globalStats = await cookieScoring.getGlobalCookieStats();
    
    // Filter for likely tracking cookies and sort by score
    const trackingCookies = globalStats
      .filter(cookie => 
        cookie.scoring.confidence !== 'low' || 
        cookie.thirdPartyRatio > 50
      )
      .sort((a, b) => b.scoring.score - a.scoring.score)
      .slice(0, limit);

    res.json({
      trackers: trackingCookies,
      summary: {
        total: trackingCookies.length,
        highConfidence: trackingCookies.filter(c => c.scoring.confidence === 'high').length,
        thirdParty: trackingCookies.filter(c => c.thirdPartyRatio > 50).length,
        averageScore: trackingCookies.reduce((sum, c) => sum + c.scoring.score, 0) / trackingCookies.length
      }
    });

  } catch (error) {
    console.error('Error getting top tracking cookies:', error);
    res.status(500).json({ error: 'Failed to get top tracking cookies' });
  }
});

// Recalculate scores for all cookies (admin endpoint)
router.post('/recalculate', async (req, res) => {
  try {
    console.log('Starting cookie score recalculation...');
    
    const globalStats = await cookieScoring.getGlobalCookieStats();
    let updated = 0;

    for (const cookieData of globalStats) {
      try {
        await db.updateCookieScoring(cookieData.cookieName, {
          score: cookieData.scoring.score,
          confidence: cookieData.scoring.confidence,
          totalOccurrences: cookieData.totalOccurrences,
          websiteCount: cookieData.websiteCount,
          primaryTracker: cookieData.scoring.originDomain || null,
          attributionProbability: 0 // Will be calculated separately if needed
        });
        updated++;
      } catch (error) {
        console.warn(`Failed to update scoring for ${cookieData.cookieName}:`, error.message);
      }
    }

    console.log(`Cookie score recalculation completed. Updated ${updated} cookies.`);
    
    res.json({
      message: 'Score recalculation completed',
      updated,
      total: globalStats.length
    });

  } catch (error) {
    console.error('Error recalculating scores:', error);
    res.status(500).json({ error: 'Failed to recalculate scores' });
  }
});

// Get scoring summary statistics
router.get('/summary', async (req, res) => {
  try {
    const globalStats = await cookieScoring.getGlobalCookieStats();
    
    const summary = {
      totalCookies: globalStats.length,
      confidenceLevels: {
        high: globalStats.filter(c => c.scoring.confidence === 'high').length,
        medium: globalStats.filter(c => c.scoring.confidence === 'medium').length,
        low: globalStats.filter(c => c.scoring.confidence === 'low').length
      },
      thirdParty: globalStats.filter(c => c.thirdPartyRatio > 50).length,
      averageScore: globalStats.reduce((sum, c) => sum + c.scoring.score, 0) / globalStats.length,
      scoreDistribution: {
        veryHigh: globalStats.filter(c => c.scoring.score >= 10).length,
        high: globalStats.filter(c => c.scoring.score >= 8 && c.scoring.score < 10).length,
        medium: globalStats.filter(c => c.scoring.score >= 4 && c.scoring.score < 8).length,
        low: globalStats.filter(c => c.scoring.score < 4).length
      },
      topTrackers: globalStats
        .filter(c => c.thirdPartyRatio > 50)
        .sort((a, b) => b.scoring.score - a.scoring.score)
        .slice(0, 10)
        .map(c => ({
          name: c.cookieName,
          originDomain: c.scoring.originDomain,
          score: c.scoring.score,
          occurrences: c.totalOccurrences,
          thirdPartyRatio: c.thirdPartyRatio
        }))
    };

    res.json(summary);

  } catch (error) {
    console.error('Error getting scoring summary:', error);
    res.status(500).json({ error: 'Failed to get scoring summary' });
  }
});

module.exports = router;