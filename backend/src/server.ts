import express, { Request, Response, Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

dotenv.config();

const app: Application = express();
const PORT: string | number = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic route
app.get('/', (_req: Request, res: Response): Response => {
  return res.json({ message: 'ProjxonApp Backend API is running!' });
});

// API routes placeholder
app.get('/api/health', (_req: Request, res: Response): Response => {
  return res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// TODO: Add routes for:
// - LinkedIn posts
// - Contact form
// - ROI calculator
// - WordPress blog posts

app.listen(PORT, (): void => {
  console.log(`Server is running on port ${PORT}`);
}); 