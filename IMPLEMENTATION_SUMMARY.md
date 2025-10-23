# Backend Changes Summary

## Overview
Successfully implemented the requested changes to support multiple scans with upsert functionality and origin domain tracking.

## Key Changes Made

### 1. Database Schema Updates
- **New `cookies` table structure** with upsert key: `(website, cookie_name, source)`
- **Added `origin_domain` column** to store main domain (e.g., `https://info.trustarc.com/`)
- **New `scan_history` table** for optimization with URL and latest scan date
- **Removed dependency on `scan_id`** for cookie storage

### 2. Upsert Functionality
- Cookies are now upserted based on the unique key: `(website, cookie_name, source)`
- Multiple scans of the same website update existing cookies instead of creating duplicates
- `updated_at` timestamp tracks when cookies were last seen/updated

### 3. Origin Domain Extraction
- Implemented `extractOriginDomain()` method to extract main domain from full URLs
- Example: `https://info.trustarc.com/rs/846-LLZ-652/images/rwtsmin_minified.js:1:33585` → `https://info.trustarc.com/`
- Handles both full URLs and stack trace formats

### 4. Scan Optimization
- New `scan_history` table tracks when URLs were last scanned
- `updateScanHistory()` method maintains scan frequency data
- API endpoint to check if a website needs rescanning

### 5. New API Endpoints

#### `/api/results/website?url=<url>`
- Get all cookies for a specific website
- Includes scan history and enhanced summary with origin domain breakdown

#### `/api/results/origin-domain?domain=<domain>`
- Get all cookies originating from a specific domain
- Shows which websites use cookies from that domain

#### `/api/scan/check/<url>`
- Check if a website has been scanned and if it needs rescanning
- Returns scan history and recommendation for rescanning

### 6. Enhanced Analytics
- Added `uniqueWebsites` count
- Added `uniqueOriginDomains` count  
- Added `totalScanHistory` count
- Origin domain breakdown in website results

## Database Schema

### Cookies Table
```sql
CREATE TABLE cookies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  website TEXT NOT NULL,           -- The scanned website URL
  cookie_name TEXT NOT NULL,       -- Cookie name
  source TEXT NOT NULL,            -- 'javascript', 'http', or 'browser'
  value TEXT,                      -- Cookie value
  origin TEXT,                     -- Full origin URL/stack trace
  origin_domain TEXT,              -- Extracted main domain
  third_party BOOLEAN DEFAULT FALSE,
  third_party_domain TEXT,
  timestamp INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(website, cookie_name, source)  -- Upsert key
);
```

### Scan History Table
```sql
CREATE TABLE scan_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  last_scan_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  scan_count INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Example Usage

### Scanning the same website multiple times:
```bash
# First scan
curl -X POST http://localhost:3001/api/scan/start \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# Second scan (updates existing cookies)
curl -X POST http://localhost:3001/api/scan/start \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### Getting website results:
```bash
curl "http://localhost:3001/api/results/website?url=https://example.com"
```

### Getting cookies by origin domain:
```bash
curl "http://localhost:3001/api/results/origin-domain?domain=https://trustarc.com/"
```

### Checking scan status:
```bash
curl "http://localhost:3001/api/scan/check/https%3A%2F%2Fexample.com"
```

## Benefits

1. **No Duplicate Data**: Multiple scans update existing records instead of creating duplicates
2. **Origin Tracking**: Easy to see which domains are setting cookies across different websites
3. **Scan Optimization**: Track scan frequency to avoid unnecessary rescans
4. **Better Analytics**: Enhanced insights into cookie usage patterns
5. **Flexible Querying**: Query by website, origin domain, or scan history

## Migration Notes

- **No migration needed** - can start from scratch as requested
- Old scan-based queries are maintained for backward compatibility
- New endpoints provide enhanced functionality while preserving existing API