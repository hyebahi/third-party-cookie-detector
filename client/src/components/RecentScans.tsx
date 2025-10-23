import React from 'react';

interface Scan {
  id: string;
  url: string;
  status: string;
  cookie_count: number;
  duration: number;
  created_at: string;
}

interface RecentScansProps {
  scans: Scan[];
  onScanSelect: (scan: Scan) => void;
}

const RecentScans: React.FC<RecentScansProps> = ({ scans, onScanSelect }) => {
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return '✅';
      case 'running': return '🔄';
      case 'failed': return '❌';
      default: return '⏳';
    }
  };

  return (
    <div className="recent-scans">
      <h3>Recent Scans</h3>
      {scans.length === 0 ? (
        <p>No scans yet</p>
      ) : (
        <div className="scans-list">
          {scans.map((scan) => (
            <div 
              key={scan.id} 
              className={`scan-item ${scan.status}`}
              onClick={() => onScanSelect(scan)}
            >
              <div className="scan-header">
                <span className="status-icon">{getStatusIcon(scan.status)}</span>
                <span className="url">{scan.url}</span>
              </div>
              <div className="scan-meta">
                <span className="cookie-count">{scan.cookie_count} cookies</span>
                {scan.duration > 0 && (
                  <span className="duration">{formatDuration(scan.duration)}</span>
                )}
                <span className="date">{formatDate(scan.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RecentScans;