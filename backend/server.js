const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'ProjxonApp Backend API is running!' });
});

// API routes placeholder
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// TODO: Add routes for:
// - LinkedIn posts
// - Contact form
// - ROI calculator
// - WordPress blog posts

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 