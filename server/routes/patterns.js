const express = require('express');
const cookiePatterns = require('../database/cookiePatterns');

const router = express.Router();

// Get all cookie patterns
router.get('/', async (req, res) => {
  try {
    const patterns = await cookiePatterns.getAllPatterns();
    res.json({
      patterns,
      total: patterns.length
    });
  } catch (error) {
    console.error('Error getting cookie patterns:', error);
    res.status(500).json({ error: 'Failed to get cookie patterns' });
  }
});

// Get pattern by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pattern = await cookiePatterns.getPattern(id);
    
    if (!pattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    
    res.json(pattern);
  } catch (error) {
    console.error('Error getting cookie pattern:', error);
    res.status(500).json({ error: 'Failed to get cookie pattern' });
  }
});

// Add new cookie pattern
router.post('/', async (req, res) => {
  try {
    const { name, pattern, matchType, rootDomain, scoreBonus, confidenceLevel, description } = req.body;
    
    // Validation
    if (!name || !pattern || !matchType || !rootDomain) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, pattern, matchType, rootDomain' 
      });
    }
    
    const validMatchTypes = ['starts_with', 'ends_with', 'contains', 'equals', 'regex'];
    if (!validMatchTypes.includes(matchType)) {
      return res.status(400).json({ 
        error: `Invalid matchType. Must be one of: ${validMatchTypes.join(', ')}` 
      });
    }
    
    const validConfidenceLevels = ['low', 'medium', 'high'];
    if (confidenceLevel && !validConfidenceLevels.includes(confidenceLevel)) {
      return res.status(400).json({ 
        error: `Invalid confidenceLevel. Must be one of: ${validConfidenceLevels.join(', ')}` 
      });
    }
    
    // Test regex pattern if type is regex
    if (matchType === 'regex') {
      try {
        new RegExp(pattern);
      } catch (e) {
        return res.status(400).json({ 
          error: 'Invalid regex pattern: ' + e.message 
        });
      }
    }
    
    const patternData = {
      name,
      pattern,
      matchType,
      rootDomain,
      scoreBonus: parseFloat(scoreBonus) || 0,
      confidenceLevel: confidenceLevel || 'medium',
      description: description || ''
    };
    
    const id = await cookiePatterns.addPattern(patternData);
    
    res.status(201).json({
      message: 'Cookie pattern added successfully',
      id,
      pattern: { id, ...patternData }
    });
  } catch (error) {
    console.error('Error adding cookie pattern:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Pattern with same cookie pattern, match type, and domain already exists' });
    } else {
      res.status(500).json({ error: 'Failed to add cookie pattern' });
    }
  }
});

// Update cookie pattern
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, pattern, matchType, rootDomain, scoreBonus, confidenceLevel, description, active } = req.body;
    
    // Check if pattern exists
    const existingPattern = await cookiePatterns.getPattern(id);
    if (!existingPattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    
    // Validation
    if (!name || !pattern || !matchType || !rootDomain) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, pattern, matchType, rootDomain' 
      });
    }
    
    const validMatchTypes = ['starts_with', 'ends_with', 'contains', 'equals', 'regex'];
    if (!validMatchTypes.includes(matchType)) {
      return res.status(400).json({ 
        error: `Invalid matchType. Must be one of: ${validMatchTypes.join(', ')}` 
      });
    }
    
    const validConfidenceLevels = ['low', 'medium', 'high'];
    if (confidenceLevel && !validConfidenceLevels.includes(confidenceLevel)) {
      return res.status(400).json({ 
        error: `Invalid confidenceLevel. Must be one of: ${validConfidenceLevels.join(', ')}` 
      });
    }
    
    // Test regex pattern if type is regex
    if (matchType === 'regex') {
      try {
        new RegExp(pattern);
      } catch (e) {
        return res.status(400).json({ 
          error: 'Invalid regex pattern: ' + e.message 
        });
      }
    }
    
    const patternData = {
      name,
      pattern,
      matchType,
      rootDomain,
      scoreBonus: parseFloat(scoreBonus) || 0,
      confidenceLevel: confidenceLevel || 'medium',
      description: description || '',
      active: active !== false
    };
    
    const changes = await cookiePatterns.updatePattern(id, patternData);
    
    if (changes === 0) {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    
    res.json({
      message: 'Cookie pattern updated successfully',
      pattern: { id: parseInt(id), ...patternData }
    });
  } catch (error) {
    console.error('Error updating cookie pattern:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Pattern with same cookie pattern, match type, and domain already exists' });
    } else {
      res.status(500).json({ error: 'Failed to update cookie pattern' });
    }
  }
});

// Toggle pattern active status
router.patch('/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;
    
    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: 'Active field must be a boolean' });
    }
    
    const changes = await cookiePatterns.togglePattern(id, active);
    
    if (changes === 0) {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    
    res.json({
      message: `Pattern ${active ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Error toggling cookie pattern:', error);
    res.status(500).json({ error: 'Failed to toggle cookie pattern' });
  }
});

// Delete cookie pattern
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const changes = await cookiePatterns.deletePattern(id);
    
    if (changes === 0) {
      return res.status(404).json({ error: 'Pattern not found' });
    }
    
    res.json({
      message: 'Cookie pattern deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting cookie pattern:', error);
    res.status(500).json({ error: 'Failed to delete cookie pattern' });
  }
});

// Test pattern against cookie name
router.post('/test', async (req, res) => {
  try {
    const { cookieName } = req.body;
    
    if (!cookieName) {
      return res.status(400).json({ error: 'cookieName is required' });
    }
    
    const matches = await cookiePatterns.matchCookiePatterns(cookieName);
    
    res.json({
      cookieName,
      matches,
      matchCount: matches.length,
      totalScoreBonus: matches.reduce((sum, match) => sum + match.score_bonus, 0)
    });
  } catch (error) {
    console.error('Error testing cookie pattern:', error);
    res.status(500).json({ error: 'Failed to test cookie pattern' });
  }
});

// Bulk test patterns against multiple cookie names
router.post('/test-bulk', async (req, res) => {
  try {
    const { cookieNames } = req.body;
    
    if (!Array.isArray(cookieNames) || cookieNames.length === 0) {
      return res.status(400).json({ error: 'cookieNames must be a non-empty array' });
    }
    
    const results = [];
    
    for (const cookieName of cookieNames) {
      const matches = await cookiePatterns.matchCookiePatterns(cookieName);
      results.push({
        cookieName,
        matches,
        matchCount: matches.length,
        totalScoreBonus: matches.reduce((sum, match) => sum + match.score_bonus, 0)
      });
    }
    
    res.json({
      results,
      summary: {
        totalCookies: cookieNames.length,
        cookiesWithMatches: results.filter(r => r.matchCount > 0).length,
        averageMatches: results.reduce((sum, r) => sum + r.matchCount, 0) / cookieNames.length
      }
    });
  } catch (error) {
    console.error('Error bulk testing cookie patterns:', error);
    res.status(500).json({ error: 'Failed to bulk test cookie patterns' });
  }
});

module.exports = router;