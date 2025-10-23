import React, { useState, useEffect } from 'react';

interface Cookie {
  id: number;
  name: string;
  value: string;
  source: string;
  origin: string;
  third_party: boolean;
  third_party_domain: string | null;
  timestamp: number;
}

interface ScanResultsProps {
  scan: {
    id?: string;
    url: string;
    status: string;
  };
}

const ScanResults: React.FC<ScanResultsProps> = ({ scan }) => {
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    if (!scan.id) return;

    const fetchResults = async () => {
      try {
        const response = await fetch(`/api/results/scan/${scan.id}`);
        const data = await response.json();
        setResults(data);
      } catch (error) {
        console.error('Failed to fetch results:', error);
      } finally {
        setLoading(false);
      }
    };

    // Poll for results if scan is running
    if (scan.status === 'running') {
      const interval = setInterval(fetchResults, 2000);
      return () => clearInterval(interval);
    } else {
      fetchResults();
    }
  }, [scan.id, scan.status]);

  if (loading) {
    return (
      <div className="scan-results">
        <h3>Scan Results</h3>
        <div className="loading">
          <div className="spinner"></div>
          <p>Scanning {scan.url}...</p>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="scan-results">
        <h3>Scan Results</h3>
        <p>No results available</p>
      </div>
    );
  }

  const { cookies, summary } = results;

  // Group third-party cookies by their tracking domains
  const thirdPartyServices = cookies
    .filter((cookie: Cookie) => cookie.third_party_domain)
    .reduce((acc: any, cookie: Cookie) => {
      const domain = cookie.third_party_domain!;
      if (!acc[domain]) {
        acc[domain] = [];
      }
      acc[domain].push(cookie);
      return acc;
    }, {});

  const thirdPartyServiceCount = Object.keys(thirdPartyServices).length;



  return (
    <div className="scan-results">
      <h3>Scan Results for {scan.url}</h3>

      <div className="summary">
        <div className="summary-card">
          <h4>Total Cookies</h4>
          <span className="count">{summary.total}</span>
        </div>
        <div className="summary-card">
          <h4>Third-Party</h4>
          <span className="count third-party">{summary.thirdParty}</span>
        </div>
        <div className="summary-card">
          <h4>First-Party</h4>
          <span className="count first-party">{summary.firstParty}</span>
        </div>
        <div className="summary-card">
          <h4>Third-Party Services</h4>
          <span className="count services">{thirdPartyServiceCount}</span>
        </div>
      </div>

      <div className="source-breakdown">
        <h4>By Source</h4>
        <div className="source-stats">
          <span>JavaScript: {summary.bySource.javascript}</span>
          <span>HTTP: {summary.bySource.http}</span>
          <span>Browser: {summary.bySource.browser}</span>
        </div>
      </div>

      {thirdPartyServiceCount > 0 && (
        <div className="third-party-services">
          <h4>🔍 Third-Party Services Detected</h4>
          <div className="services-grid">
            {Object.entries(thirdPartyServices).map(([domain, serviceCookies]: [string, any]) => (
              <div key={domain} className="service-card">
                <div className="service-header">
                  <span className="service-domain">{domain}</span>
                  <span className="service-count">{serviceCookies.length} cookies</span>
                </div>
                <div className="service-cookies">
                  {serviceCookies.slice(0, 3).map((cookie: Cookie) => (
                    <span key={cookie.id} className="service-cookie">{cookie.name}</span>
                  ))}
                  {serviceCookies.length > 3 && (
                    <span className="service-more">+{serviceCookies.length - 3} more</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="cookies-table">
        <h4>Cookie Details</h4>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Value</th>
                <th>Source</th>
                <th>Origin</th>
                <th>Third-Party Service</th>
              </tr>
            </thead>
            <tbody>
              {cookies.map((cookie: Cookie) => (
                <tr key={cookie.id} className={cookie.third_party ? 'third-party-row' : 'first-party-row'}>
                  <td className="cookie-name">{cookie.name}</td>
                  <td className="cookie-value" title={cookie.value}>
                    {cookie.value.length > 30
                      ? cookie.value.substring(0, 30) + '...'
                      : cookie.value}
                  </td>
                  <td className="cookie-source">
                    <span className={`source-badge ${cookie.source}`}>{cookie.source}</span>
                  </td>
                  <td className="cookie-origin" title={cookie.origin}>
                    {cookie.origin.length > 40
                      ? cookie.origin.substring(0, 40) + '...'
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ScanResults;