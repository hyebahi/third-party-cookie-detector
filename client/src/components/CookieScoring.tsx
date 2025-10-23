import React, { useState, useEffect } from 'react';
import './CookieScoring.css';

interface ScoringBreakdown {
  baseScore: number;
  thirdPartyBonus: number;
  occurrenceMultiplier: number;
  occurrenceCount: number;
}

interface Attribution {
  probability: number;
  primaryOrigin: string;
  distribution: Record<string, number>;
  totalOccurrences: number;
}

interface CookieScoring {
  score: number;
  confidence: 'low' | 'medium' | 'high';
  breakdown: ScoringBreakdown;
  cookieName: string;
  originDomain: string;
}

interface ScoredCookie {
  id: number;
  name: string;
  website: string;
  source: string;
  origin: string;
  third_party: boolean;
  third_party_domain: string | null;
  scoring: CookieScoring;
  attribution: Attribution;
}

interface ScoringData {
  website?: string;
  pattern?: string;
  websites?: string[];
  cookies: ScoredCookie[];
  summary: {
    total: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    thirdParty: number;
    averageScore: number;
    websiteCount?: number;
  };
}

interface GlobalCookieStats {
  cookieName: string;
  totalOccurrences: number;
  websiteCount: number;
  originCount: number;
  thirdPartyRatio: number;
  scoring: CookieScoring;
  originDomains: string[];
}

interface GlobalScoringData {
  cookies: GlobalCookieStats[];
  summary: {
    total: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    thirdParty: number;
    averageScore: number;
  };
}

const CookieScoringComponent: React.FC = () => {
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteScoring, setWebsiteScoring] = useState<ScoringData | null>(null);
  const [globalScoring, setGlobalScoring] = useState<GlobalScoringData | null>(null);
  const [loading, setLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'website' | 'global'>('global');

  // Load global scoring on component mount
  useEffect(() => {
    fetchGlobalScoring();
  }, []);

  const fetchGlobalScoring = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/scoring/global');
      if (!response.ok) throw new Error('Failed to fetch global scoring');
      const data = await response.json();
      setGlobalScoring(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch global scoring');
    } finally {
      setLoading(false);
    }
  };

  const fetchWebsiteScoring = async () => {
    if (!websiteUrl) {
      setError('Please enter a website URL');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccessMessage('');

      let url = websiteUrl;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      const response = await fetch(`/api/scoring/website?url=${encodeURIComponent(url)}`);
      if (!response.ok) throw new Error('Failed to fetch website scoring');

      const data = await response.json();
      setWebsiteScoring(data);
      setActiveTab('website');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch website scoring');
    } finally {
      setLoading(false);
    }
  };

  const recalculateScores = async () => {
    try {
      setRecalculating(true);
      setError('');
      setSuccessMessage('');

      const response = await fetch('/api/scoring/recalculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Failed to recalculate scores');

      const result = await response.json();
      setSuccessMessage(`✅ Recalculated scores for ${result.updated} cookies`);

      // Refresh the global scoring data
      await fetchGlobalScoring();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recalculate scores');
    } finally {
      setRecalculating(false);
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high': return '#27ae60';
      case 'medium': return '#f39c12';
      case 'low': return '#e74c3c';
      default: return '#95a5a6';
    }
  };

  const getConfidenceLabel = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'High Confidence';
      case 'medium': return 'Medium Confidence';
      case 'low': return 'Under Analysis';
      default: return 'Unknown';
    }
  };

  return (
    <div className="cookie-scoring">
      <div className="scoring-header">
        <h2>🎯 Cookie Attribution Scoring</h2>
        <p>Analyze cookie origins and confidence levels based on detection methods and occurrence patterns</p>
      </div>

      {/* Website Scoring Form */}
      <div className="website-scoring-form">
        <div className="form-group">
          <input
            type="text"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="Enter website URL or pattern (e.g., trustarc.com, *.trustarc.com, %google%)"
            className="website-input"
            onKeyPress={(e) => e.key === 'Enter' && fetchWebsiteScoring()}
          />
          <button
            onClick={fetchWebsiteScoring}
            disabled={loading}
            className="analyze-button"
          >
            {loading ? '🔍 Analyzing...' : '📊 Analyze Website'}
          </button>
        </div>
        <div className="wildcard-help">
          <small>💡 Use wildcards: <code>*</code> for any characters, <code>%</code> for SQL-style matching. Examples: <code>*.example.com</code>, <code>%google%</code></small>
        </div>
        {error && <div className="error-message">{error}</div>}
        {successMessage && <div className="success-message">{successMessage}</div>}
      </div>

      {/* Recalculate Button */}
      <div className="recalculate-section">
        <button
          onClick={recalculateScores}
          disabled={recalculating}
          className="recalculate-button"
          title="Recalculate all cookie scores based on current data"
        >
          {recalculating ? '🔄 Recalculating...' : '🔄 Recalculate All Scores'}
        </button>
        <p className="recalculate-help">
          Click to update all cookie scores based on the latest scan data
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button
          className={`tab-button ${activeTab === 'global' ? 'active' : ''}`}
          onClick={() => setActiveTab('global')}
        >
          Global Cookie Stats
        </button>
        <button
          className={`tab-button ${activeTab === 'website' ? 'active' : ''}`}
          onClick={() => setActiveTab('website')}
          disabled={!websiteScoring}
        >
          Website Analysis
        </button>
      </div>

      {loading && (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Calculating scores...</p>
        </div>
      )}

      {/* Global Scoring Tab */}
      {activeTab === 'global' && globalScoring && (
        <div className="global-scoring">
          <div className="scoring-summary">
            <div className="summary-cards">
              <div className="summary-card">
                <div className="card-number">{globalScoring.summary.total}</div>
                <div className="card-label">Total Cookies</div>
              </div>
              <div className="summary-card high">
                <div className="card-number">{globalScoring.summary.highConfidence}</div>
                <div className="card-label">High Confidence</div>
              </div>
              <div className="summary-card medium">
                <div className="card-number">{globalScoring.summary.mediumConfidence}</div>
                <div className="card-label">Medium Confidence</div>
              </div>
              <div className="summary-card low">
                <div className="card-number">{globalScoring.summary.lowConfidence}</div>
                <div className="card-label">Under Analysis</div>
              </div>
              <div className="summary-card">
                <div className="card-number">{globalScoring.summary.averageScore ? globalScoring.summary.averageScore.toFixed(1) : '0.0'}</div>
                <div className="card-label">Average Score</div>
              </div>
            </div>
          </div>

          <div className="cookies-table-container">
            <h3>Cookie Scoring Results</h3>
            <div className="table-wrapper">
              <table className="scoring-table">
                <thead>
                  <tr>
                    <th>Cookie Name</th>
                    <th className="tooltip-header" title="Score based on detection method (JS=3, HTTP=1, Browser=0.5) + third-party bonus (+2) + pattern bonus + occurrence multiplier">Score</th>
                    <th className="tooltip-header" title="High: Score ≥8 or pattern match with score ≥5 | Medium: Score ≥4 or pattern match with score ≥2 | Low: All others">Confidence</th>
                    <th>Origin Domain</th>
                    <th className="tooltip-header" title="Percentage of times this cookie was detected as third-party across all occurrences. 100% = always third-party, 0% = always first-party">Third-Party %</th>
                  </tr>
                </thead>
                <tbody>
                  {globalScoring.cookies
                    .sort((a, b) => b.scoring.score - a.scoring.score)
                    .map((cookie, index) => (
                      <tr key={cookie.cookieName}>
                        <td className="cookie-name-cell">
                          <strong>{cookie.cookieName}</strong>
                        </td>
                        <td className="score-cell">
                          <div className="score-badge" style={{ backgroundColor: getConfidenceColor(cookie.scoring.confidence) }}>
                            {cookie.scoring.score}
                          </div>
                        </td>
                        <td className="confidence-cell">
                          <span className={`confidence-badge ${cookie.scoring.confidence}`}>
                            {getConfidenceLabel(cookie.scoring.confidence)}
                          </span>
                        </td>
                        <td className="origin-cell">
                          {cookie.scoring.originDomain}
                        </td>
                        <td className="third-party-cell">
                          <span className={`percentage ${cookie.thirdPartyRatio > 50 ? 'high' : 'low'}`}>
                            {cookie.thirdPartyRatio}%
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Website Scoring Tab */}
      {activeTab === 'website' && websiteScoring && (
        <div className="website-scoring">
          <div className="website-header">
            <h3>Analysis for: {websiteScoring.website || websiteScoring.pattern}</h3>
            {websiteScoring.pattern && websiteScoring.summary?.websiteCount && websiteScoring.summary.websiteCount > 0 && (
              <p className="pattern-info">
                📊 Pattern matched <strong>{websiteScoring.summary.websiteCount}</strong> websites
                {websiteScoring.websites && websiteScoring.websites.length <= 10 && (
                  <span className="matched-websites">
                    : {websiteScoring.websites.join(', ')}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="scoring-summary">
            <div className="summary-cards">
              <div className="summary-card">
                <div className="card-number">{websiteScoring.summary.total}</div>
                <div className="card-label">Total Cookies</div>
              </div>
              <div className="summary-card high">
                <div className="card-number">{websiteScoring.summary.highConfidence}</div>
                <div className="card-label">High Confidence</div>
              </div>
              <div className="summary-card medium">
                <div className="card-number">{websiteScoring.summary.mediumConfidence}</div>
                <div className="card-label">Medium Confidence</div>
              </div>
              <div className="summary-card low">
                <div className="card-number">{websiteScoring.summary.lowConfidence}</div>
                <div className="card-label">Under Analysis</div>
              </div>
              <div className="summary-card">
                <div className="card-number">{websiteScoring.summary.averageScore ? websiteScoring.summary.averageScore.toFixed(1) : '0.0'}</div>
                <div className="card-label">Average Score</div>
              </div>
              {websiteScoring.summary?.websiteCount && websiteScoring.summary.websiteCount > 0 && (
                <div className="summary-card">
                  <div className="card-number">{websiteScoring.summary.websiteCount}</div>
                  <div className="card-label">Websites</div>
                </div>
              )}
            </div>
          </div>

          <div className="cookies-table-container">
            <div className="table-wrapper">
              <table className="scoring-table">
                <thead>
                  <tr>
                    <th>Cookie Name</th>
                    <th className="tooltip-header" title="Score based on detection method (JS=3, HTTP=1, Browser=0.5) + third-party bonus (+2) + pattern bonus + occurrence multiplier">Score</th>
                    <th className="tooltip-header" title="High: Score ≥8 or pattern match with score ≥5 | Medium: Score ≥4 or pattern match with score ≥2 | Low: All others">Confidence</th>
                    <th className="tooltip-header" title="Detection method: JavaScript (highest confidence), HTTP headers, or Browser storage">Source</th>
                    <th>Origin</th>
                    <th>Attribution</th>
                    <th className="tooltip-header" title="Whether this cookie was detected as third-party (from external domain) or first-party (same domain)">Third-Party</th>
                  </tr>
                </thead>
                <tbody>
                  {websiteScoring.cookies.map((cookie, index) => (
                    <tr key={`${cookie.name}-${cookie.id}`}>
                      <td className="cookie-name-cell" title={cookie.name}>
                        <strong>{cookie.name}</strong>
                      </td>
                      <td className="score-cell">
                        <div className="score-badge" style={{ backgroundColor: getConfidenceColor(cookie.scoring.confidence) }}>
                          {cookie.scoring.score}
                        </div>
                      </td>
                      <td className="confidence-cell">
                        <span className={`confidence-badge ${cookie.scoring.confidence}`}>
                          {getConfidenceLabel(cookie.scoring.confidence)}
                        </span>
                      </td>
                      <td className="source-cell">
                        <span className={`source-badge ${cookie.source}`}>
                          {cookie.source}
                        </span>
                      </td>
                      <td className="origin-cell" title={cookie.origin}>
                        {cookie.origin.length > 40
                          ? cookie.origin.substring(0, 40) + '...'
                          : cookie.origin}
                      </td>
                      <td className="attribution-cell">
                        <div className="attribution-info">
                          <strong>{cookie.attribution.probability}%</strong>
                          <div className="attribution-domain" title={cookie.attribution.primaryOrigin}>
                            {cookie.attribution.primaryOrigin}
                          </div>
                        </div>
                      </td>
                      <td className="third-party-cell">
                        {cookie.third_party ? (
                          <span className="third-party-yes">
                            {cookie.third_party_domain || 'Yes'}
                          </span>
                        ) : (
                          <span className="third-party-no">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};

export default CookieScoringComponent;