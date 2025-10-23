import React, { useState, useEffect } from 'react';

interface Stats {
  totalScans: number;
  completedScans: number;
  totalCookies: number;
  thirdPartyCookies: number;
  uniqueDomains: number;
}

const Analytics: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [trackers, setTrackers] = useState<any[]>([]);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const [statsResponse, trackersResponse] = await Promise.all([
          fetch('/api/results/analytics'),
          fetch('/api/results/trackers?limit=5')
        ]);
        
        const statsData = await statsResponse.json();
        const trackersData = await trackersResponse.json();
        
        setStats(statsData);
        setTrackers(trackersData);
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      }
    };

    fetchAnalytics();
  }, []);

  if (!stats) {
    return (
      <div className="analytics">
        <h3>Analytics</h3>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="analytics">
      <h3>📊 Analytics</h3>
      
      <div className="stats-grid">
        <div className="stat-item">
          <span className="stat-value">{stats.totalScans}</span>
          <span className="stat-label">Total Scans</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.totalCookies}</span>
          <span className="stat-label">Cookies Found</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.thirdPartyCookies}</span>
          <span className="stat-label">3rd Party</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.uniqueDomains}</span>
          <span className="stat-label">Unique Domains</span>
        </div>
      </div>

      {trackers.length > 0 && (
        <div className="top-trackers">
          <h4>Top Trackers</h4>
          <div className="trackers-list">
            {trackers.map((tracker, index) => (
              <div key={index} className="tracker-item">
                <span className="cookie-name">{tracker.cookie_name}</span>
                <span className="domain">{tracker.domain}</span>
                <span className="count">{tracker.occurrence_count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Analytics;