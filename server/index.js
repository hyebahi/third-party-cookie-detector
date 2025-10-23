const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const scanRoutes = require('./routes/scan');
const resultsRoutes = require('./routes/results');
const scoringRoutes = require('./routes/scoring');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/scan', scanRoutes);
app.use('/api/results', resultsRoutes);
app.use('/api/scoring', scoringRoutes);

// Serve static files from React build
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Cookie Scanner API running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
});