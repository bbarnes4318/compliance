const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const { connectDatabase } = require('./src/config/database');
const { logger } = require('./src/utils/logger');
const { errorHandler } = require('./src/middleware/errorHandler');
const { authenticate } = require('./src/middleware/auth');

const consentRoutes = require('./src/routes/consent');
const fwaRoutes = require('./src/routes/fwa');
const documentRoutes = require('./src/routes/documents');
const screeningRoutes = require('./src/routes/screening');
const trainingRoutes = require('./src/routes/training');
const auditRoutes = require('./src/routes/audit');
const dashboardRoutes = require('./src/routes/dashboard');
const callRoutes = require('./src/routes/calls');
const authRoutes = require('./src/routes/auth');
const complianceRoutes = require('./src/routes/compliance');

const { startScheduledTasks } = require('./src/services/scheduler');
const { initializeRedis } = require('./src/config/redis');
const { initializeSocketIO } = require('./src/config/websocket');

const app = express();
const PORT = process.env.PORT || 3000;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use('/api/', limiter);

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/consent', authenticate, consentRoutes);
app.use('/api/fwa', authenticate, fwaRoutes);
app.use('/api/documents', authenticate, documentRoutes);
app.use('/api/screening', authenticate, screeningRoutes);
app.use('/api/training', authenticate, trainingRoutes);
app.use('/api/audit', authenticate, auditRoutes);
app.use('/api/dashboard', authenticate, dashboardRoutes);
app.use('/api/calls', authenticate, callRoutes);
app.use('/api/compliance', authenticate, complianceRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.use(errorHandler);

app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl
  });
});

async function startServer() {
  try {
    await connectDatabase();
    logger.info('Database connected successfully');

    await initializeRedis();
    logger.info('Redis cache initialized');

    const server = app.listen(PORT, () => {
      logger.info(`Medicare/ACA Compliance System running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`CMS Contract Year 2025 Compliance Active`);
    });

    initializeSocketIO(server);
    logger.info('WebSocket server initialized');

    startScheduledTasks();
    logger.info('Scheduled compliance tasks started');

    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;