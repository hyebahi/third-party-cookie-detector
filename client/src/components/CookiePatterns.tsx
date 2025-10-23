import React, { useState, useEffect } from 'react';
import './CookiePatterns.css';

interface CookiePattern {
  id: number;
  pattern_name: string;
  cookie_pattern: string;
  match_type: 'starts_with' | 'ends_with' | 'contains' | 'equals' | 'regex';
  root_domain: string;
  score_bonus: number;
  confidence_level: 'low' | 'medium' | 'high';
  description: string;
  active: boolean;
  case_sensitive: boolean;
  created_at: string;
  updated_at: string;
}

interface PatternFormData {
  name: string;
  pattern: string;
  matchType: string;
  rootDomain: string;
  scoreBonus: number;
  confidenceLevel: string;
  description: string;
  caseSensitive: boolean;
}

const CookiePatterns: React.FC = () => {
  const [patterns, setPatterns] = useState<CookiePattern[]>([]);
  const [filteredPatterns, setFilteredPatterns] = useState<CookiePattern[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPattern, setEditingPattern] = useState<CookiePattern | null>(null);
  const [testCookie, setTestCookie] = useState('');
  const [testResults, setTestResults] = useState<any>(null);

  const [formData, setFormData] = useState<PatternFormData>({
    name: '',
    pattern: '',
    matchType: 'starts_with',
    rootDomain: '',
    scoreBonus: 0,
    confidenceLevel: 'medium',
    description: '',
    caseSensitive: false
  });

  useEffect(() => {
    fetchPatterns();
  }, []);

  // Filter patterns when search term or patterns change
  useEffect(() => {
    if (!searchFilter.trim()) {
      setFilteredPatterns(patterns);
    } else {
      const filtered = patterns.filter(pattern => 
        pattern.pattern_name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        pattern.cookie_pattern.toLowerCase().includes(searchFilter.toLowerCase()) ||
        pattern.root_domain.toLowerCase().includes(searchFilter.toLowerCase()) ||
        pattern.description.toLowerCase().includes(searchFilter.toLowerCase())
      );
      setFilteredPatterns(filtered);
    }
  }, [patterns, searchFilter]);

  const fetchPatterns = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/patterns');
      const data = await response.json();
      
      if (response.ok) {
        setPatterns(data.patterns);
      } else {
        setError(data.error || 'Failed to fetch patterns');
      }
    } catch (err) {
      setError('Network error while fetching patterns');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const url = editingPattern ? `/api/patterns/${editingPattern.id}` : '/api/patterns';
      const method = editingPattern ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        await fetchPatterns();
        resetForm();
        setShowForm(false);
        setEditingPattern(null);
      } else {
        setError(data.error || 'Failed to save pattern');
      }
    } catch (err) {
      setError('Network error while saving pattern');
    }
  };

  const handleEdit = (pattern: CookiePattern) => {
    setFormData({
      name: pattern.pattern_name,
      pattern: pattern.cookie_pattern,
      matchType: pattern.match_type,
      rootDomain: pattern.root_domain,
      scoreBonus: pattern.score_bonus,
      confidenceLevel: pattern.confidence_level,
      description: pattern.description,
      caseSensitive: pattern.case_sensitive || false
    });
    setEditingPattern(pattern);
    setShowForm(true);
    
    // Scroll to top to show the form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this pattern?')) {
      return;
    }
    
    try {
      const response = await fetch(`/api/patterns/${id}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        await fetchPatterns();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to delete pattern');
      }
    } catch (err) {
      setError('Network error while deleting pattern');
    }
  };

  const handleToggle = async (id: number, active: boolean) => {
    try {
      const response = await fetch(`/api/patterns/${id}/toggle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ active }),
      });
      
      if (response.ok) {
        await fetchPatterns();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to toggle pattern');
      }
    } catch (err) {
      setError('Network error while toggling pattern');
    }
  };

  const testPattern = async () => {
    if (!testCookie.trim()) return;
    
    try {
      const response = await fetch('/api/patterns/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cookieName: testCookie }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setTestResults(data);
      } else {
        setError(data.error || 'Failed to test pattern');
      }
    } catch (err) {
      setError('Network error while testing pattern');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      pattern: '',
      matchType: 'starts_with',
      rootDomain: '',
      scoreBonus: 0,
      confidenceLevel: 'medium',
      description: '',
      caseSensitive: false
    });
  };

  const getMatchTypeLabel = (type: string) => {
    switch (type) {
      case 'starts_with': return 'Starts With';
      case 'ends_with': return 'Ends With';
      case 'contains': return 'Contains';
      case 'equals': return 'Equals';
      case 'regex': return 'Regex';
      default: return type;
    }
  };

  const getConfidenceBadge = (level: string) => {
    const className = `confidence-badge confidence-${level}`;
    return <span className={className}>{level.toUpperCase()}</span>;
  };

  if (loading) {
    return <div className="loading">Loading cookie patterns...</div>;
  }

  return (
    <div className="cookie-patterns">
      <div className="patterns-header">
        <h2>Cookie Scoring Patterns</h2>
        <p>Configure patterns to automatically identify and score cookies from known services.</p>
        
        <div className="header-actions">
          <button 
            className="btn btn-primary"
            onClick={() => {
              resetForm();
              setEditingPattern(null);
              setShowForm(!showForm);
            }}
          >
            {showForm ? 'Cancel' : 'Add Pattern'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Test Section */}
      <div className="test-section">
        <h3>Test Cookie Pattern</h3>
        <div className="test-form">
          <input
            type="text"
            placeholder="Enter cookie name to test..."
            value={testCookie}
            onChange={(e) => setTestCookie(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && testPattern()}
          />
          <button onClick={testPattern} disabled={!testCookie.trim()}>
            Test
          </button>
        </div>
        
        {testResults && (
          <div className="test-results">
            <h4>Test Results for "{testResults.cookieName}"</h4>
            <p>Matches: {testResults.matchCount} | Total Score Bonus: +{testResults.totalScoreBonus}</p>
            
            {testResults.matches.length > 0 ? (
              <div className="matches">
                {testResults.matches.map((match: any, index: number) => (
                  <div key={index} className="match-item">
                    <strong>{match.pattern_name}</strong> ({match.root_domain})
                    <br />
                    Pattern: "{match.cookie_pattern}" ({getMatchTypeLabel(match.match_type)})
                    <br />
                    Score Bonus: +{match.score_bonus} | {getConfidenceBadge(match.confidence_level)}
                  </div>
                ))}
              </div>
            ) : (
              <p className="no-matches">No patterns matched this cookie name.</p>
            )}
          </div>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="pattern-form">
          <h3>{editingPattern ? 'Edit Pattern' : 'Add New Pattern'}</h3>
          <form onSubmit={handleSubmit}>
            {/* Pattern Name */}
            <div className="form-section">
              <div className="form-group full-width">
                <label>Pattern Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Google Analytics, Facebook Pixel, Adobe Analytics"
                  required
                />
                <small className="help-text">A friendly name to identify this cookie pattern</small>
              </div>
            </div>

            {/* Pattern Matching Rules */}
            <div className="form-section">
              <h4 className="section-title">Pattern Matching</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Cookie Pattern *</label>
                  <input
                    type="text"
                    value={formData.pattern}
                    onChange={(e) => setFormData({ ...formData, pattern: e.target.value })}
                    placeholder="e.g., _ga, fbp, s_cc"
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Match Type *</label>
                  <select
                    value={formData.matchType}
                    onChange={(e) => setFormData({ ...formData, matchType: e.target.value })}
                    required
                  >
                    <option value="contains">Contains</option>
                    <option value="starts_with">Starts With</option>
                    <option value="ends_with">Ends With</option>
                    <option value="equals">Exact Match</option>
                    <option value="regex">Regular Expression</option>
                  </select>
                </div>

                <div className="form-group checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.caseSensitive}
                      onChange={(e) => setFormData({ ...formData, caseSensitive: e.target.checked })}
                    />
                    Case Sensitive
                  </label>
                  <small className="help-text">Match exact case (GA ≠ ga)</small>
                </div>
                
                <div className="form-group">
                  <label>Root Domain *</label>
                  <input
                    type="text"
                    value={formData.rootDomain}
                    onChange={(e) => setFormData({ ...formData, rootDomain: e.target.value })}
                    placeholder="e.g., google.com, facebook.com"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Scoring & Confidence */}
            <div className="form-section">
              <h4 className="section-title">Scoring & Confidence</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Confidence Level</label>
                  <select
                    value={formData.confidenceLevel}
                    onChange={(e) => setFormData({ ...formData, confidenceLevel: e.target.value })}
                  >
                    <option value="high">High - Very reliable match</option>
                    <option value="medium">Medium - Good match</option>
                    <option value="low">Low - Possible match</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Score Bonus</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={formData.scoreBonus}
                    onChange={(e) => setFormData({ ...formData, scoreBonus: parseFloat(e.target.value) || 0 })}
                    placeholder="0.0"
                  />
                  <small className="help-text">Additional points (0-10) for this match</small>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="form-section">
              <div className="form-group full-width">
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe what this cookie is used for, e.g., 'Google Analytics tracking cookie for measuring website traffic and user behavior'"
                  rows={5}
                />
                <small className="help-text">Optional: Explain what this cookie pattern detects</small>
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                {editingPattern ? 'Update Pattern' : 'Add Pattern'}
              </button>
              <button 
                type="button" 
                className="btn btn-secondary"
                onClick={() => {
                  setShowForm(false);
                  setEditingPattern(null);
                  resetForm();
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Patterns List */}
      <div className="patterns-list">
        <div className="patterns-list-header">
          <h3>Configured Patterns ({patterns.length})</h3>
          <div className="search-filter">
            <input
              type="text"
              placeholder="Search patterns by name, pattern, domain, or description..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="search-input"
            />
            {searchFilter && (
              <button 
                className="clear-search"
                onClick={() => setSearchFilter('')}
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>
        
        {searchFilter && (
          <div className="search-results-info">
            Showing {filteredPatterns.length} of {patterns.length} patterns
          </div>
        )}
        
        {filteredPatterns.length === 0 && patterns.length === 0 ? (
          <div className="no-patterns">
            <p>No cookie patterns configured yet.</p>
            <button 
              className="btn btn-primary"
              onClick={() => setShowForm(true)}
            >
              Add Your First Pattern
            </button>
          </div>
        ) : filteredPatterns.length === 0 ? (
          <div className="no-patterns">
            <p>No patterns match your search criteria.</p>
            <button 
              className="btn btn-secondary"
              onClick={() => setSearchFilter('')}
            >
              Clear Search
            </button>
          </div>
        ) : (
          <div className="patterns-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Pattern</th>
                  <th>Match Type</th>
                  <th>Domain</th>
                  <th>Score Bonus</th>
                  <th>Confidence</th>
                  <th>Case Sensitive</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPatterns.map((pattern) => (
                  <tr key={pattern.id} className={!pattern.active ? 'inactive' : ''}>
                    <td>
                      <strong>{pattern.pattern_name}</strong>
                      {pattern.description && (
                        <div className="pattern-description">{pattern.description}</div>
                      )}
                    </td>
                    <td>
                      <code>{pattern.cookie_pattern}</code>
                    </td>
                    <td>{getMatchTypeLabel(pattern.match_type)}</td>
                    <td>{pattern.root_domain}</td>
                    <td>+{pattern.score_bonus}</td>
                    <td>{getConfidenceBadge(pattern.confidence_level)}</td>
                    <td>
                      <span className={`case-sensitive-badge ${pattern.case_sensitive ? 'yes' : 'no'}`}>
                        {pattern.case_sensitive ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td>
                      <label className="toggle-switch">
                        <input
                          type="checkbox"
                          checked={pattern.active}
                          onChange={(e) => handleToggle(pattern.id, e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                      </label>
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button
                          className="btn btn-small btn-secondary"
                          onClick={() => handleEdit(pattern)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-small btn-danger"
                          onClick={() => handleDelete(pattern.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default CookiePatterns;