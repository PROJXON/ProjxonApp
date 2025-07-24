import express, { Request, Response, Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app: Application = express();
const PORT: string | number = process.env.PORT || 3000;

// Security and utility middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (_req: Request, res: Response): Response => {
  return res.json({ 
    message: 'ProjxonApp Backend API is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (_req: Request, res: Response): Response => {
  return res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// TODO: Future API endpoints
// GET  /api/linkedin/posts      - Company LinkedIn posts
// POST /api/contact             - Contact form submission  
// POST /api/roi/calculate       - ROI calculator
// GET  /api/blog/posts          - WordPress blog posts

// Error handling middleware
app.use((_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, (): void => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
}); 