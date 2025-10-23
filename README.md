# 🍪 Cookie Scanner & Attribution Platform

A comprehensive cookie detection and analysis platform that identifies, scores, and attributes first-party and third-party cookies on websites using advanced pattern matching and Playwright automation.

## Features

- **Real-time Cookie Detection**: Monitors JavaScript and HTTP cookie creation with stack trace analysis
- **Cookie Pattern Management**: Define and manage cookie patterns with confidence scoring
- **Third-party Attribution**: Advanced scoring system for cookie attribution and confidence levels
- **Interactive Web Dashboard**: React-based frontend with pattern testing and management
- **RESTful API**: Backend API for programmatic access and integration
- **Database Storage**: Persistent storage of scan results, patterns, and attribution data
- **Analytics Dashboard**: Insights into cookie usage patterns, scoring, and top trackers

## Architecture

```
├── server/                 # Node.js/Express API
│   ├── scanner/           # Playwright-based cookie detection & attribution
│   ├── database/          # SQLite database layer
│   ├── routes/            # API endpoints (scans, patterns, results)
│   ├── services/          # Business logic & scoring algorithms
│   └── scripts/           # Database initialization & migrations
├── client/                # React TypeScript frontend
│   └── src/components/    # UI components (Scanner, Patterns, Analytics)
└── server/data/           # SQLite database files
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

### Cookie Pattern Management
- `GET /api/patterns` - Get all cookie patterns
- `POST /api/patterns` - Create new cookie pattern
- `PUT /api/patterns/:id` - Update existing pattern
- `DELETE /api/patterns/:id` - Delete pattern
- `POST /api/patterns/test` - Test cookie name against patterns

### Results & Analytics
- `GET /api/results/scan/:scanId` - Get detailed scan results with scoring
- `GET /api/results/trackers` - Get top tracking domains
- `GET /api/results/analytics` - Get platform statistics
- `GET /api/scoring/:scanId` - Get cookie attribution scores

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

## Cookie Detection & Attribution

### Detection Capabilities
The scanner detects cookies set via:

- **JavaScript**: `document.cookie` assignments, `cookieStore.set()`
- **HTTP Headers**: `Set-Cookie` response headers
- **Third-party Scripts**: Cross-origin tracking pixels and analytics
- **Tag Managers**: Google Tag Manager, Adobe Launch, Tealium

### Attribution Features

- **Pattern Matching**: Flexible pattern matching (contains, starts with, ends with, exact, regex)
- **Confidence Scoring**: High/Medium/Low confidence levels for attribution accuracy
- **Score Bonuses**: Configurable bonus points for specific pattern matches
- **Case Sensitivity**: Optional case-sensitive pattern matching
- **Domain Attribution**: Root domain tracking for third-party identification
- **Stack Trace Analysis**: JavaScript execution context for precise attribution
- **Real-time Testing**: Interactive pattern testing interface

## Database Schema

### Scans Table
- Scan metadata (URL, status, duration, cookie count, timestamps)

### Cookies Table
- Individual cookie details (name, value, source, origin, third-party flag)
- Attribution data (matched patterns, confidence scores, bonus points)

### Cookie Patterns Table
- Pattern definitions (name, pattern, match type, root domain)
- Scoring configuration (confidence level, score bonus, case sensitivity)
- Pattern metadata (description, active status, timestamps)

### Trackers Table
- Aggregated tracking statistics (occurrence count, domains, attribution scores)

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
2. **Pattern matching**: Update attribution logic in `server/services/`
3. **API endpoints**: Add routes in `server/routes/`
4. **UI components**: Create components in `client/src/components/`
5. **Database changes**: Update schema in `server/database/db.js`

## Key Components

### Cookie Pattern Management
- **Pattern Editor**: User-friendly form for creating and editing cookie patterns
- **Pattern Testing**: Real-time testing interface to validate patterns against cookie names
- **Bulk Operations**: Import/export patterns, bulk enable/disable functionality
- **Pattern Analytics**: Usage statistics and match frequency analysis

### Attribution Scoring System
- **Confidence Levels**: High (90-100%), Medium (60-89%), Low (0-59%) confidence scoring
- **Score Bonuses**: Additional points for high-value or critical cookie matches
- **Match Types**: Support for contains, starts with, ends with, exact match, and regex patterns
- **Domain Mapping**: Automatic attribution to root domains for third-party tracking

## Future Enhancements

- **Machine Learning**: AI-powered pattern suggestion and auto-classification
- **Consent Detection**: Enhanced consent management platform detection
- **Export Features**: CSV/JSON export of scan results and patterns
- **Scheduled Scans**: Automated periodic scanning with trend analysis
- **Advanced Analytics**: Historical trend analysis and comparative reporting
- **Pattern Marketplace**: Community-driven pattern sharing and validation

## License

ISC License