import React, { useState } from 'react';

interface ScanFormProps {
  onScanStarted: (scan: any) => void;
}

const ScanForm: React.FC<ScanFormProps> = ({ onScanStarted }) => {
  const [url, setUrl] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');

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

      onScanStarted({
        url: scanUrl,
        status: 'running',
        created_at: new Date().toISOString()
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="scan-form">
      <h2>Start New Scan</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter website URL (e.g., example.com)"
            disabled={isScanning}
            className="url-input"
          />
          <button 
            type="submit" 
            disabled={isScanning}
            className="scan-button"
          >
            {isScanning ? '🔍 Scanning...' : '🚀 Start Scan'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
};

export default ScanForm;