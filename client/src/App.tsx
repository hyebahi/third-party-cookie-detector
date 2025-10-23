import React, { useState, useEffect } from 'react';
import './App.css';
import CookieScoring from './components/CookieScoring';
import CookiePatterns from './components/CookiePatterns';

interface Cookie {
  id: number;
  website: string;
  name: string;
  value: string;
  source: string;
  origin: string;
  origin_domain: string | null;
  third_party: boolean;
  third_party_domain: string | null;
  timestamp: number;
  created_at: string;
  updated_at: string;
}

interface Scan {
  id: string;
  url: string;
  status: string;
  cookie_count: number;
  duration: number;
  created_at: string;
  cookies?: Cookie[];
}

function App() {
  const [url, setUrl] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');
  const [allCookies, setAllCookies] = useState<Cookie[]>([]);
  const [recentScans, setRecentScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'scanner' | 'scoring' | 'patterns'>('scanner');

  const fetchAllData = async () => {
    try {
      setLoading(true);
      
      // Fetch recent scans for display
      const scansResponse = await fetch('/api/scan/recent?limit=50');
      const scans = await scansResponse.json();
      setRecentScans(scans);

      // Fetch ALL cookies using the new endpoint
      const allCookiesResponse = await fetch('/api/results/all?limit=10000');
      const allCookiesData = await allCookiesResponse.json();
      
      if (allCookiesData.cookies) {
        // Add website info to each cookie for display
        const cookiesWithWebsite = allCookiesData.cookies.map((cookie: any) => ({
          ...cookie,
          scan_url: cookie.website,
          scan_date: cookie.created_at
        }));
        setAllCookies(cookiesWithWebsite);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!url) {
      setError('Please enter a URL');
      return;
    }

    // Add protocol if missing
    let scanUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      scanUrl = 'https://' + url;
    }

    try {
      setIsScanning(true);
      
      const response = await fetch('/api/scan/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: scanUrl }),
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to start scan');
      }

      setUrl(''); // Clear the input
      
      // Poll for completion and refresh data
      const pollForCompletion = async () => {
        let attempts = 0;
        const maxAttempts = 30; // 1 minute max
        
        const poll = async () => {
          attempts++;
          try {
            const recentResponse = await fetch('/api/scan/recent?limit=1');
            const recentScans = await recentResponse.json();
            
            if (recentScans.length > 0 && recentScans[0].url === scanUrl) {
              if (recentScans[0].status === 'completed' || recentScans[0].status === 'failed') {
                // Scan completed, refresh all data
                await fetchAllData();
                return;
              }
            }
            
            if (attempts < maxAttempts) {
              setTimeout(poll, 2000); // Poll every 2 seconds
            }
          } catch (err) {
            console.error('Polling error:', err);
          }
        };
        
        setTimeout(poll, 2000); // Start polling after 2 seconds
      };
      
      pollForCompletion();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
    } finally {
      setIsScanning(false);
    }
  };

  // Group cookies by website
  const cookiesByWebsite = allCookies.reduce((acc: any, cookie: any) => {
    const key = cookie.website || cookie.scan_url || 'Unknown';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(cookie);
    return acc;
  }, {});

  // CSV Export function
  const downloadCSV = () => {
    const headers = [
      'Website',
      'Cookie Name',
      'Value',
      'Source',
      'Origin',
      'Third Party Service',
      'Is Third Party',
      'Date Scanned'
    ];

    const csvData = allCookies.map((cookie: any) => [
      cookie.website || cookie.scan_url || 'Unknown',
      cookie.name,
      cookie.value,
      cookie.source,
      cookie.origin,
      cookie.third_party_domain || '',
      cookie.third_party ? 'Yes' : 'No',
      new Date(cookie.updated_at || cookie.created_at).toLocaleDateString()
    ]);

    const csvContent = [
      headers.join(','),
      ...csvData.map(row => 
        row.map(field => 
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          typeof field === 'string' && (field.includes(',') || field.includes('"') || field.includes('\n'))
            ? `"${field.replace(/"/g, '""')}"`
            : field
        ).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `cookie-scan-data-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy to clipboard function
  const copyToClipboard = async () => {
    const headers = ['Website', 'Cookie Name', 'Value', 'Source', 'Origin', 'Third Party Service', 'Is Third Party', 'Date'];
    
    const textData = [
      headers.join('\t'),
      ...allCookies.map((cookie: any) => [
        cookie.website || cookie.scan_url || 'Unknown',
        cookie.name,
        cookie.value,
        cookie.source,
        cookie.origin,
        cookie.third_party_domain || '',
        cookie.third_party ? 'Yes' : 'No',
        new Date(cookie.updated_at || cookie.created_at).toLocaleDateString()
      ].join('\t'))
    ].join('\n');

    try {
      await navigator.clipboard.writeText(textData);
      
      // Show temporary success message
      const button = document.querySelector('.copy-button') as HTMLButtonElement;
      if (button) {
        const originalText = button.textContent;
        button.textContent = '✅ Copied!';
        button.style.background = '#27ae60';
        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = '';
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      alert('Failed to copy to clipboard. Please try the CSV download instead.');
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>🍪 Cookie Scanner</h1>
        <p>Detect and analyze cookies on any website</p>
        
        {/* Navigation Tabs */}
        <nav className="main-navigation">
          <button 
            className={`nav-tab ${activeTab === 'scanner' ? 'active' : ''}`}
            onClick={() => setActiveTab('scanner')}
          >
            🔍 Scanner
          </button>
          <button 
            className={`nav-tab ${activeTab === 'scoring' ? 'active' : ''}`}
            onClick={() => setActiveTab('scoring')}
          >
            🎯 Scoring
          </button>
          <button 
            className={`nav-tab ${activeTab === 'patterns' ? 'active' : ''}`}
            onClick={() => setActiveTab('patterns')}
          >
            ⚙️ Patterns
          </button>
        </nav>
      </header>

      <main className="App-main">
        <div className="container">
          {activeTab === 'scoring' ? (
            <CookieScoring />
          ) : activeTab === 'patterns' ? (
            <CookiePatterns />
          ) : (
            <>
              {/* Scan Form */}
              <div className="scan-form">
            <form onSubmit={handleSubmit} className="scan-form-inline">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter website URL (e.g., ea.com, trustarc.com)"
                disabled={isScanning}
                className="url-input"
              />
              <button 
                type="submit" 
                disabled={isScanning}
                className="scan-button"
              >
                {isScanning ? '🔍 Scanning...' : '🚀 Scan'}
              </button>
            </form>
            {error && <div className="error">{error}</div>}
          </div>

          {/* Results */}
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>
              <p>Loading cookie data...</p>
            </div>
          ) : (
            <div className="results-section">
              <div className="stats">
                <div className="stat">
                  <span className="stat-number">{allCookies.length}</span>
                  <span className="stat-label">Total Cookies</span>
                </div>
                <div className="stat">
                  <span className="stat-number">{allCookies.filter(c => c.third_party).length}</span>
                  <span className="stat-label">Third-Party</span>
                </div>
                <div className="stat">
                  <span className="stat-number">{Object.keys(cookiesByWebsite).length}</span>
                  <span className="stat-label">Websites Scanned</span>
                </div>
                <div className="stat">
                  <span className="stat-number">{new Set(allCookies.filter(c => c.third_party_domain).map(c => c.third_party_domain)).size}</span>
                  <span className="stat-label">Tracking Services</span>
                </div>
              </div>

              <div className="cookies-list">
                <div className="cookies-header">
                  <h2>All Cookies ({allCookies.length})</h2>
                  {allCookies.length > 0 && (
                    <div className="export-buttons">
                      <button 
                        onClick={downloadCSV} 
                        className="export-button csv-button"
                        title="Download as CSV"
                      >
                        📥 Download CSV
                      </button>
                      <button 
                        onClick={copyToClipboard} 
                        className="export-button copy-button"
                        title="Copy to clipboard"
                      >
                        📋 Copy Data
                      </button>
                    </div>
                  )}
                </div>
                
                {allCookies.length === 0 ? (
                  <div className="empty-state">
                    <p>No cookies found. Start by scanning a website above.</p>
                  </div>
                ) : (
                  <div className="table-wrapper">
                    <table className="cookies-table">
                      <thead>
                        <tr>
                          <th>Website</th>
                          <th>Cookie Name</th>
                          <th>Value</th>
                          <th>Source</th>
                          <th>Origin</th>
                          <th>Third-Party Service</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allCookies
                          .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
                          .map((cookie: any) => (
                          <tr key={`${cookie.website}-${cookie.name}-${cookie.source}-${cookie.id}`} className={cookie.third_party ? 'third-party-row' : 'first-party-row'}>
                            <td className="website-cell">
                              <span className="website-url">{cookie.website || cookie.scan_url}</span>
                            </td>
                            <td className="cookie-name" title={cookie.name}>
                              {cookie.name.length > 25
                                ? cookie.name.substring(0, 25) + '...'
                                : cookie.name}
                            </td>
                            <td className="cookie-value" title={cookie.value}>
                              {cookie.value.length > 30
                                ? cookie.value.substring(0, 30) + '...'
                                : cookie.value}
                            </td>
                            <td className="cookie-source">
                              <span className={`source-badge ${cookie.source}`}>{cookie.source}</span>
                            </td>
                            <td className="cookie-origin" title={cookie.origin}>
                              {cookie.origin.length > 50
                                ? cookie.origin.substring(0, 50) + '...'
                                : cookie.origin}
                            </td>
                            <td className="cookie-service">
                              {cookie.third_party_domain ? (
                                <span className="service-badge" title={`Tracking domain: ${cookie.third_party_domain}`}>
                                  {cookie.third_party_domain}
                                </span>
                              ) : (
                                <span className="no-service">-</span>
                              )}
                            </td>
                            <td className="cookie-date">
                              {new Date(cookie.created_at).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
