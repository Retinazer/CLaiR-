const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/overview', require('./routes/overview'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/restock', require('./routes/restock'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/forecast', require('./routes/forecast'));
app.use('/api/simulation', require('./routes/simulation'));
app.use('/api/expiry', require('./routes/expiry'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend static assets
const frontendDir = path.join(__dirname, '../frontend');
app.use(express.static(frontendDir));

// Fallback to index.html for frontend routing
app.use((req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 CLaiR Server running at: http://localhost:${PORT}`);
  console.log(`📊 API endpoints available at: http://localhost:${PORT}/api/...\n`);
});
