const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/cookies.db');

class Database {
  constructor() {
    this.db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err.message);
      } else {
        console.log('📁 Connected to SQLite database');
        this.initTables();
      }
    });
  }

  initTables() {
    const createScansTable = `
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        status TEXT NOT NULL,
        cookie_count INTEGER DEFAULT 0,
        duration INTEGER DEFAULT 0,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // New optimized cookies table with upsert key: website + cookie_name + source
    const createCookiesTable = `
      CREATE TABLE IF NOT EXISTS cookies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        website TEXT NOT NULL,
        cookie_name TEXT NOT NULL,
        source TEXT NOT NULL,
        value TEXT,
        origin TEXT,
        origin_domain TEXT,
        third_party BOOLEAN DEFAULT FALSE,
        third_party_domain TEXT,
        timestamp INTEGER,
        score REAL DEFAULT 0,
        confidence TEXT DEFAULT 'low',
        tracker_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(website, cookie_name, source)
      )
    `;

    // New scan optimization table
    const createScanHistoryTable = `
      CREATE TABLE IF NOT EXISTS scan_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        last_scan_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        scan_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createTrackersTable = `
      CREATE TABLE IF NOT EXISTS trackers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cookie_name TEXT NOT NULL,
        domain TEXT NOT NULL,
        tracker_name TEXT,
        score REAL DEFAULT 1,
        confidence TEXT DEFAULT 'low',
        attribution_probability INTEGER DEFAULT 0,
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        occurrence_count INTEGER DEFAULT 1,
        UNIQUE(cookie_name, domain)
      )
    `;

    // Cookie scoring summary table for quick lookups
    const createCookieScoringTable = `
      CREATE TABLE IF NOT EXISTS cookie_scoring (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cookie_name TEXT NOT NULL UNIQUE,
        global_score REAL DEFAULT 0,
        global_confidence TEXT DEFAULT 'low',
        total_occurrences INTEGER DEFAULT 0,
        website_count INTEGER DEFAULT 0,
        primary_tracker TEXT,
        attribution_probability INTEGER DEFAULT 0,
        last_calculated DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.serialize(() => {
      this.db.run(createScansTable);
      this.db.run(createCookiesTable);
      this.db.run(createScanHistoryTable);
      this.db.run(createTrackersTable);
      this.db.run(createCookieScoringTable);
    });
  }

  // Scan operations
  createScan(id, url, status) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO scans (id, url, status) VALUES (?, ?, ?)
      `);
      stmt.run([id, url, status], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
      stmt.finalize();
    });
  }

  updateScan(id, status, cookieCount = 0, duration = 0, errorMessage = null) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        UPDATE scans 
        SET status = ?, cookie_count = ?, duration = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      stmt.run([status, cookieCount, duration, errorMessage, id], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      stmt.finalize();
    });
  }

  getScan(id) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM scans WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  getRecentScans(limit = 10) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM scans 
        ORDER BY created_at DESC 
        LIMIT ?
      `, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Cookie operations with upsert functionality
  storeCookie(website, cookie) {
    return new Promise((resolve, reject) => {
      // Extract origin domain from the full origin URL
      const originDomain = this.extractOriginDomain(cookie.origin);
      
      const stmt = this.db.prepare(`
        INSERT INTO cookies (website, cookie_name, source, value, origin, origin_domain, third_party, third_party_domain, timestamp, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(website, cookie_name, source) DO UPDATE SET
          value = excluded.value,
          origin = excluded.origin,
          origin_domain = excluded.origin_domain,
          third_party = excluded.third_party,
          third_party_domain = excluded.third_party_domain,
          timestamp = excluded.timestamp,
          updated_at = CURRENT_TIMESTAMP
      `);
      
      stmt.run([
        website,
        cookie.name,
        cookie.source,
        cookie.value,
        cookie.origin,
        originDomain,
        cookie.thirdParty ? 1 : 0,
        cookie.thirdPartyDomain || null,
        cookie.timestamp
      ], function(err) {
        if (err) reject(err);
        else {
          resolve(this.lastID);
          // Update tracker statistics
          if (cookie.thirdParty && cookie.thirdPartyDomain) {
            db.updateTrackerStats(cookie.name, cookie.thirdPartyDomain);
          }
        }
      });
      stmt.finalize();
    });
  }

  // Update cookie scoring data
  updateCookieScoring(cookieName, scoringData) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO cookie_scoring (
          cookie_name, global_score, global_confidence, total_occurrences, 
          website_count, primary_tracker, attribution_probability, last_calculated, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(cookie_name) DO UPDATE SET
          global_score = excluded.global_score,
          global_confidence = excluded.global_confidence,
          total_occurrences = excluded.total_occurrences,
          website_count = excluded.website_count,
          primary_tracker = excluded.primary_tracker,
          attribution_probability = excluded.attribution_probability,
          last_calculated = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `);
      
      stmt.run([
        cookieName,
        scoringData.score,
        scoringData.confidence,
        scoringData.totalOccurrences,
        scoringData.websiteCount,
        scoringData.primaryTracker,
        scoringData.attributionProbability
      ], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      stmt.finalize();
    });
  }

  // Get cookie scoring data
  getCookieScoring(cookieName) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM cookie_scoring WHERE cookie_name = ?`, [cookieName], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  // Get all cookie scoring data
  getAllCookieScoring(limit = 100) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM cookie_scoring 
        ORDER BY global_score DESC, total_occurrences DESC
        LIMIT ?
      `, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Update scan history for optimization
  updateScanHistory(url) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO scan_history (url, last_scan_date, scan_count, updated_at)
        VALUES (?, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(url) DO UPDATE SET
          last_scan_date = CURRENT_TIMESTAMP,
          scan_count = scan_count + 1,
          updated_at = CURRENT_TIMESTAMP
      `);
      
      stmt.run([url], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      stmt.finalize();
    });
  }

  // Get scan history for a URL
  getScanHistory(url) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM scan_history WHERE url = ?`, [url], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  getCookiesByWebsite(website) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          id,
          website,
          cookie_name as name,
          source,
          value,
          origin,
          origin_domain,
          third_party,
          third_party_domain,
          timestamp,
          created_at,
          updated_at
        FROM cookies 
        WHERE website = ? 
        ORDER BY updated_at DESC
      `, [website], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Get all cookies with optional filtering
  getAllCookies(limit = 100, offset = 0) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          id,
          website,
          cookie_name as name,
          source,
          value,
          origin,
          origin_domain,
          third_party,
          third_party_domain,
          timestamp,
          created_at,
          updated_at
        FROM cookies 
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `, [limit, offset], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Get cookies by origin domain
  getCookiesByOriginDomain(originDomain) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          id,
          website,
          cookie_name as name,
          source,
          value,
          origin,
          origin_domain,
          third_party,
          third_party_domain,
          timestamp,
          created_at,
          updated_at
        FROM cookies 
        WHERE origin_domain = ? 
        ORDER BY updated_at DESC
      `, [originDomain], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Tracker operations
  updateTrackerStats(cookieName, origin) {
    const domain = this.extractDomain(origin);
    if (!domain) return;

    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT INTO trackers (cookie_name, domain, last_seen, occurrence_count)
        VALUES (?, ?, CURRENT_TIMESTAMP, 1)
        ON CONFLICT(cookie_name, domain) DO UPDATE SET
          last_seen = CURRENT_TIMESTAMP,
          occurrence_count = occurrence_count + 1
      `, [cookieName, domain], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  getTopTrackers(limit = 20) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          cookie_name,
          domain,
          tracker_name,
          occurrence_count,
          score,
          first_seen,
          last_seen
        FROM trackers 
        ORDER BY occurrence_count DESC, score DESC
        LIMIT ?
      `, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Analytics
  getStats() {
    return new Promise((resolve, reject) => {
      const queries = {
        totalScans: `SELECT COUNT(*) as count FROM scans`,
        completedScans: `SELECT COUNT(*) as count FROM scans WHERE status = 'completed'`,
        totalCookies: `SELECT COUNT(*) as count FROM cookies`,
        thirdPartyCookies: `SELECT COUNT(*) as count FROM cookies WHERE third_party = 1`,
        uniqueWebsites: `SELECT COUNT(DISTINCT website) as count FROM cookies`,
        uniqueOriginDomains: `SELECT COUNT(DISTINCT origin_domain) as count FROM cookies WHERE origin_domain IS NOT NULL`,
        uniqueDomains: `SELECT COUNT(DISTINCT domain) as count FROM trackers`,
        totalScanHistory: `SELECT COUNT(*) as count FROM scan_history`
      };

      const stats = {};
      let completed = 0;
      const total = Object.keys(queries).length;

      Object.entries(queries).forEach(([key, query]) => {
        this.db.get(query, (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          stats[key] = row.count;
          completed++;
          if (completed === total) {
            resolve(stats);
          }
        });
      });
    });
  }

  extractDomain(origin) {
    try {
      if (origin.startsWith('http')) {
        return new URL(origin).hostname;
      }
      // Extract domain from stack trace format
      const match = origin.match(/https?:\/\/([^\/:\s]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  extractOriginDomain(origin) {
    try {
      if (!origin) return null;
      
      // Handle full URLs
      if (origin.startsWith('http')) {
        const url = new URL(origin);
        return `${url.protocol}//${url.hostname}/`;
      }
      
      // Handle stack trace format like "https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js:1:33585"
      const match = origin.match(/https?:\/\/([^\/:\s]+)/);
      if (match) {
        const protocol = origin.startsWith('https') ? 'https' : 'http';
        return `${protocol}://${match[1]}/`;
      }
      
      return null;
    } catch {
      return null;
    }
  }

  close() {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) console.error('Error closing database:', err.message);
        else console.log('📁 Database connection closed');
        resolve();
      });
    });
  }
}

const db = new Database();
module.exports = db;