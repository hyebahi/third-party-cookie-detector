const express = require('express');
const CookieScanner = require('../scanner/cookieScanner');
const db = require('../database/db');

const router = express.Router();
const scanner = new CookieScanner();

// Start a new scan
router.post('/start', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    console.log(`🚀 Starting scan for: ${url}`);
    
    // Start scan asynchronously
    const scanPromise = scanner.scanWebsite(url);
    
    // Return immediately with scan started status
    res.json({ 
      message: 'Scan started',
      url,
      status: 'running'
    });

    // Handle scan completion/failure in background
    try {
      await scanPromise;
    } catch (error) {
      console.error(`Scan failed for ${url}:`, error.message);
    }

  } catch (error) {
    console.error('Error starting scan:', error);
    res.status(500).json({ error: 'Failed to start scan' });
  }
});

// Get scan status
router.get('/status/:scanId', async (req, res) => {
  try {
    const { scanId } = req.params;
    const scan = await db.getScan(scanId);
    
    if (!scan) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    let cookies = [];
    if (scan.status === 'completed') {
      // Get cookies by website URL instead of scan ID
      cookies = await db.getCookiesByWebsite(scan.url);
    }

    res.json({
      ...scan,
      cookies
    });

  } catch (error) {
    console.error('Error getting scan status:', error);
    res.status(500).json({ error: 'Failed to get scan status' });
  }
});

// Check if website needs scanning (optimization endpoint)
router.get('/check/:url', async (req, res) => {
  try {
    const url = decodeURIComponent(req.params.url);
    
    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const scanHistory = await db.getScanHistory(url);
    const cookies = await db.getCookiesByWebsite(url);
    
    res.json({
      url,
      scanHistory,
      hasData: cookies.length > 0,
      cookieCount: cookies.length,
      needsRescan: !scanHistory || (Date.now() - new Date(scanHistory.last_scan_date).getTime()) > 24 * 60 * 60 * 1000 // 24 hours
    });

  } catch (error) {
    console.error('Error checking scan status:', error);
    res.status(500).json({ error: 'Failed to check scan status' });
  }
});

// Get recent scans
router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const scans = await db.getRecentScans(limit);
    res.json(scans);
  } catch (error) {
    console.error('Error getting recent scans:', error);
    res.status(500).json({ error: 'Failed to get recent scans' });
  }
});

module.exports = router;