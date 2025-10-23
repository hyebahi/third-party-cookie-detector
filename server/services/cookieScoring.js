const db = require('../database/db');

class CookieScoring {
  constructor() {
    // No hardcoded patterns - we'll rely on data-driven scoring
  }

  /**
   * Calculate score for a single cookie based on detection method and occurrence patterns
   */
  calculateCookieScore(cookie, occurrenceData = null) {
    let baseScore = 0;
    let confidence = 'low';

    // Base score by detection method
    switch (cookie.source) {
      case 'javascript':
        baseScore = 3; // Highest confidence - direct JS detection
        break;
      case 'http':
        baseScore = 1; // Lower confidence - HTTP header
        break;
      case 'browser':
        baseScore = 0.5; // Lowest confidence - found in storage only
        break;
      default:
        baseScore = 0.5;
    }

    // Third-party detection bonus
    let thirdPartyBonus = 0;
    if (cookie.third_party && cookie.third_party_domain) {
      thirdPartyBonus = 2; // Standard third-party bonus
    }

    // Occurrence multiplier (logarithmic scaling)
    let occurrenceMultiplier = 1;
    if (occurrenceData && occurrenceData.count > 1) {
      occurrenceMultiplier = Math.log10(occurrenceData.count + 1) * 2;
    }

    // Calculate final score
    const finalScore = (baseScore + thirdPartyBonus) * occurrenceMultiplier;

    // Determine confidence level based on score
    if (finalScore >= 8) {
      confidence = 'high';
    } else if (finalScore >= 4) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      score: Math.round(finalScore * 10) / 10, // Round to 1 decimal
      confidence,
      breakdown: {
        baseScore,
        thirdPartyBonus,
        occurrenceMultiplier,
        occurrenceCount: occurrenceData?.count || 1
      },
      cookieName: cookie.name,
      originDomain: this.extractRootDomain(cookie.third_party_domain) || this.extractRootDomain(this.extractDomainFromOrigin(cookie.origin)) || 'unknown'
    };
  }



  /**
   * Calculate attribution probability based on origin analysis
   */
  calculateAttributionProbability(cookieName, origins) {
    if (!origins || origins.length === 0) {
      return {
        probability: 0,
        primaryOrigin: 'unknown',
        confidence: 'low',
        analysis: 'No origin data available'
      };
    }

    // Count occurrences by origin domain
    // For third-party cookies, prioritize third_party_domain over origin domain
    const originCounts = {};
    let totalCount = 0;

    origins.forEach(origin => {
      let domain = null;
      
      // For third-party cookies, use the third_party_domain as the attribution source
      if (origin.isThirdParty && origin.thirdPartyDomain) {
        domain = this.extractRootDomain(origin.thirdPartyDomain);
      } else {
        // Fallback to extracting domain from origin URL
        const fullDomain = this.extractDomainFromOrigin(origin.origin);
        domain = this.extractRootDomain(fullDomain);
      }
      
      if (domain) {
        originCounts[domain] = (originCounts[domain] || 0) + 1;
        totalCount++;
      }
    });

    if (totalCount === 0) {
      return {
        probability: 0,
        primaryOrigin: 'unknown',
        confidence: 'low',
        analysis: 'Could not extract domains from origins'
      };
    }

    // Find the most common origin
    const sortedOrigins = Object.entries(originCounts)
      .sort(([, a], [, b]) => b - a);

    const [primaryOrigin, primaryCount] = sortedOrigins[0];
    const probability = Math.round((primaryCount / totalCount) * 100);

    // Calculate origin diversity metrics
    const uniqueOrigins = Object.keys(originCounts).length;
    const dominanceRatio = primaryCount / totalCount;

    // Check if this is a tie situation (multiple origins with same count)
    const maxCount = Math.max(...Object.values(originCounts));
    const originsWithMaxCount = Object.entries(originCounts).filter(([, count]) => count === maxCount);
    const isTie = originsWithMaxCount.length > 1;

    // Determine confidence based on attribution patterns
    let confidence = 'medium';
    let analysis = '';

    if (uniqueOrigins === 1) {
      confidence = 'high';
      analysis = 'Single origin - high confidence attribution';
    } else if (isTie && uniqueOrigins >= 3) {
      confidence = 'low';
      analysis = `Equal distribution across ${uniqueOrigins} origins - no clear attribution`;
      // For ties, indicate uncertainty rather than picking arbitrary "primary"
    } else if (dominanceRatio >= 0.8) {
      confidence = 'high';
      analysis = `Dominant origin (${probability}%) - high confidence`;
    } else if (dominanceRatio >= 0.6) {
      confidence = 'medium';
      analysis = `Majority origin (${probability}%) - moderate confidence`;
    } else if (uniqueOrigins >= 3 && dominanceRatio < 0.6) {
      confidence = 'low';
      analysis = `High origin diversity (${uniqueOrigins} origins) - attribution uncertain`;
    } else {
      confidence = 'medium';
      analysis = `Multiple origins detected - ${probability}% attribution`;
    }

    // For complete ties with multiple origins, indicate no clear attribution
    let finalPrimaryOrigin = primaryOrigin;
    if (isTie && uniqueOrigins >= 3) {
      finalPrimaryOrigin = 'multiple-origins';
      analysis = `Equal distribution across ${uniqueOrigins} origins - no clear attribution`;
    }

    return {
      probability,
      primaryOrigin: finalPrimaryOrigin,
      distribution: originCounts,
      totalOccurrences: totalCount,
      confidence,
      analysis,
      metrics: {
        uniqueOrigins,
        dominanceRatio: Math.round(dominanceRatio * 100),
        isHighDiversity: uniqueOrigins >= 3 && dominanceRatio < 0.6,
        isTie: isTie,
        tiedOrigins: isTie ? originsWithMaxCount.length : 0
      }
    };
  }

  /**
   * Extract domain from origin string
   */
  extractDomainFromOrigin(origin) {
    try {
      if (!origin) return null;

      if (origin.startsWith('http')) {
        return new URL(origin).hostname;
      }

      // Handle stack trace format
      const match = origin.match(/https?:\/\/([^\/:\s]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * Extract root domain from a full domain (remove subdomains)
   * Examples:
   * - 846-llz-652.mktoresp.com → mktoresp.com
   * - info.trustarc.com → trustarc.com
   * - www.google.com → google.com
   */
  extractRootDomain(domain) {
    if (!domain) return null;
    
    try {
      // Split domain into parts
      const parts = domain.toLowerCase().split('.');
      
      // If less than 2 parts, return as is
      if (parts.length < 2) return domain;
      
      // Handle special cases for known TLDs
      const knownTwoPartTlds = [
        'co.uk', 'co.jp', 'co.kr', 'co.za', 'com.au', 'com.br', 
        'com.cn', 'com.mx', 'com.tr', 'org.uk', 'net.au'
      ];
      
      // Check if domain ends with a known two-part TLD
      const lastTwoParts = parts.slice(-2).join('.');
      if (knownTwoPartTlds.includes(lastTwoParts)) {
        // Return domain.tld.ext (3 parts)
        return parts.slice(-3).join('.');
      }
      
      // For standard TLDs, return domain.tld (2 parts)
      return parts.slice(-2).join('.');
    } catch {
      return domain;
    }
  }

  /**
   * Score all cookies for a website with occurrence data
   */
  async scoreWebsiteCookies(website) {
    try {
      // Get all cookies for the website
      const cookies = await db.getCookiesByWebsite(website);

      // Get occurrence data for each cookie
      const cookieOccurrences = await this.getCookieOccurrences(website);

      // Score each cookie
      const scoredCookies = cookies.map(cookie => {
        const occurrenceData = cookieOccurrences[cookie.name];
        const scoring = this.calculateCookieScore(cookie, occurrenceData);

        return {
          ...cookie,
          scoring,
          attribution: this.calculateAttributionProbability(
            cookie.name,
            occurrenceData?.origins || [{ origin: cookie.origin }]
          )
        };
      });

      // Sort by score (highest first)
      scoredCookies.sort((a, b) => b.scoring.score - a.scoring.score);

      return {
        website,
        cookies: scoredCookies,
        summary: {
          total: scoredCookies.length,
          highConfidence: scoredCookies.filter(c => c.scoring.confidence === 'high').length,
          mediumConfidence: scoredCookies.filter(c => c.scoring.confidence === 'medium').length,
          lowConfidence: scoredCookies.filter(c => c.scoring.confidence === 'low').length,
          thirdParty: scoredCookies.filter(c => c.third_party).length,
          averageScore: scoredCookies.reduce((sum, c) => sum + c.scoring.score, 0) / scoredCookies.length
        }
      };
    } catch (error) {
      console.error('Error scoring website cookies:', error);
      throw error;
    }
  }

  /**
   * Get occurrence data for cookies on a website
   */
  async getCookieOccurrences(website) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          cookie_name,
          COUNT(*) as count,
          GROUP_CONCAT(origin) as origins,
          GROUP_CONCAT(third_party) as third_parties,
          GROUP_CONCAT(third_party_domain) as third_party_domains,
          GROUP_CONCAT(source) as sources,
          MIN(created_at) as first_seen,
          MAX(updated_at) as last_seen
        FROM cookies 
        WHERE website = ? 
        GROUP BY cookie_name
      `;

      db.db.all(query, [website], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const occurrences = {};
        rows.forEach(row => {
          const origins = row.origins ? row.origins.split(',') : [];
          const thirdParties = row.third_parties ? row.third_parties.split(',') : [];
          const thirdPartyDomains = row.third_party_domains ? row.third_party_domains.split(',') : [];
          
          // Combine origin data with third-party information
          const originsWithThirdParty = origins.map((origin, index) => ({
            origin: origin,
            isThirdParty: thirdParties[index] === '1',
            thirdPartyDomain: thirdPartyDomains[index] !== 'null' ? thirdPartyDomains[index] : null
          }));
          
          occurrences[row.cookie_name] = {
            count: row.count,
            origins: originsWithThirdParty,
            sources: row.sources ? row.sources.split(',') : [],
            firstSeen: row.first_seen,
            lastSeen: row.last_seen
          };
        });

        resolve(occurrences);
      });
    });
  }

  /**
   * Get global cookie statistics across all websites
   */
  async getGlobalCookieStats() {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          cookie_name,
          COUNT(*) as total_occurrences,
          COUNT(DISTINCT website) as website_count,
          COUNT(DISTINCT origin_domain) as origin_count,
          AVG(CASE WHEN third_party = 1 THEN 1.0 ELSE 0.0 END) as third_party_ratio,
          GROUP_CONCAT(origin) as origins,
          GROUP_CONCAT(third_party) as third_parties,
          GROUP_CONCAT(third_party_domain) as third_party_domains,
          GROUP_CONCAT(DISTINCT origin_domain) as origin_domains
        FROM cookies 
        GROUP BY cookie_name
        HAVING total_occurrences >= 1
        ORDER BY total_occurrences DESC
      `;

      db.db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const stats = rows.map(row => {
          // Get all origins for this cookie to calculate proper attribution
          const origins = row.origins ? row.origins.split(',') : [];
          const thirdParties = row.third_parties ? row.third_parties.split(',') : [];
          const thirdPartyDomains = row.third_party_domains ? row.third_party_domains.split(',') : [];
          
          // Combine origin data with third-party information
          const originsWithThirdParty = origins.map((origin, index) => ({
            origin: origin.trim(),
            isThirdParty: thirdParties[index] === '1',
            thirdPartyDomain: thirdPartyDomains[index] !== 'null' ? thirdPartyDomains[index] : null
          }));

          // Calculate attribution to find the primary origin
          const attribution = this.calculateAttributionProbability(row.cookie_name, originsWithThirdParty);

          const mockCookie = {
            name: row.cookie_name,
            source: 'javascript', // Assume JS for scoring
            third_party: row.third_party_ratio > 0.5,
            third_party_domain: (attribution.primaryOrigin !== 'unknown' && attribution.primaryOrigin !== 'multiple-origins') ? attribution.primaryOrigin : null,
            origin: attribution.primaryOrigin || 'unknown'
          };

          const scoring = this.calculateCookieScore(mockCookie, { count: row.total_occurrences });

          // Override the originDomain with the primary attribution
          scoring.originDomain = attribution.primaryOrigin || 'unknown';

          return {
            cookieName: row.cookie_name,
            totalOccurrences: row.total_occurrences,
            websiteCount: row.website_count,
            originCount: row.origin_count,
            thirdPartyRatio: Math.round(row.third_party_ratio * 100),
            scoring,
            originDomains: row.origin_domains ? row.origin_domains.split(',') : [],
            attribution
          };
        });

        resolve(stats);
      });
    });
  }
}

module.exports = CookieScoring;