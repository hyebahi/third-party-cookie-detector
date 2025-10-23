# 🍪 Cookie Scanner API

A comprehensive cookie detection and analysis platform that identifies first-party and third-party cookies on websites using Playwright automation.

## Features

- **Real-time Cookie Detection**: Monitors JavaScript and HTTP cookie creation
- **Third-party Tracking Analysis**: Identifies cross-origin cookies and tracking domains
- **Web Dashboard**: React-based frontend for managing scans and viewing results
- **RESTful API**: Backend API for programmatic access
- **Database Storage**: Persistent storage of scan results and tracker statistics
- **Analytics Dashboard**: Insights into cookie usage patterns and top trackers

## Architecture

```
├── server/                 # Node.js/Express API
│   ├── scanner/           # Playwright-based cookie detection
│   ├── database/          # SQLite database layer
│   ├── routes/            # API endpoints
│   └── scripts/           # Database initialization
├── client/                # React TypeScript frontend
│   └── src/components/    # UI components
└── data/                  # SQLite database files
```

## Quick Start

### Prerequisites

- Node.js 16+
- npm or yarn

### Installation

1. **Clone and install dependencies**:
```bash
git clone <repository>
cd cookie-scanner-api
npm run install:all
```

2. **Initialize database**:
```bash
npm run db:init
```

3. **Start development servers**:
```bash
npm run dev
```

This starts both the API server (port 3001) and React dev server (port 3000).

### Production Deployment

1. **Build the frontend**:
```bash
npm run build
```

2. **Start production server**:
```bash
NODE_ENV=production npm start
```

## API Endpoints

### Scan Management
- `POST /api/scan/start` - Start a new website scan
- `GET /api/scan/status/:scanId` - Get scan status and results
- `GET /api/scan/recent` - Get recent scans

### Results & Analytics
- `GET /api/results/scan/:scanId` - Get detailed scan results
- `GET /api/results/trackers` - Get top tracking domains
- `GET /api/results/analytics` - Get platform statistics

## Usage Examples

### Start a Scan
```bash
curl -X POST http://localhost:3001/api/scan/start \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### Get Results
```bash
curl http://localhost:3001/api/results/scan/{scanId}
```

## Cookie Detection Capabilities

The scanner detects cookies set via:

- **JavaScript**: `document.cookie` assignments, `cookieStore.set()`
- **HTTP Headers**: `Set-Cookie` response headers
- **Third-party Scripts**: Cross-origin tracking pixels and analytics
- **Tag Managers**: Google Tag Manager, Adobe Launch, Tealium

### Detection Features

- Stack trace analysis for attribution
- Third-party domain identification
- Cookie source classification (JS/HTTP/Browser)
- Real-time monitoring during page load
- Consent management integration

## Database Schema

### Scans Table
- Scan metadata (URL, status, duration, cookie count)

### Cookies Table
- Individual cookie details (name, value, source, origin, third-party flag)

### Trackers Table
- Aggregated tracking statistics (occurrence count, domains)

## Configuration

Environment variables (see `.env.example`):

- `PORT` - API server port (default: 3001)
- `NODE_ENV` - Environment mode
- `PLAYWRIGHT_USER_AGENT` - Browser user agent
- `DB_PATH` - SQLite database path

## Development

### Project Structure
- **Backend**: Express.js with SQLite database
- **Frontend**: React with TypeScript
- **Scanner**: Playwright automation with CDP monitoring
- **Database**: SQLite with manual schema management

### Adding New Features

1. **Scanner enhancements**: Modify `server/scanner/cookieScanner.js`
2. **API endpoints**: Add routes in `server/routes/`
3. **UI components**: Create components in `client/src/components/`
4. **Database changes**: Update schema in `server/database/db.js`

## Future Enhancements

- **Tracker Scoring**: Implement scoring system for known trackers
- **Consent Detection**: Enhanced consent management platform detection
- **Export Features**: CSV/JSON export of scan results
- **Scheduled Scans**: Automated periodic scanning
- **Advanced Analytics**: Trend analysis and reporting

## License

ISC License