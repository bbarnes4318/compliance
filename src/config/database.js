const { Sequelize } = require('sequelize');
const { logger } = require('../utils/logger');

// DigitalOcean Managed PostgreSQL Configuration
const getDatabaseConfig = () => {
  const config = {
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? (msg) => logger.debug(msg) : false,
    pool: {
      max: 20,
      min: 5,
      acquire: 60000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
      paranoid: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      deletedAt: 'deleted_at'
    },
    dialectOptions: {
      ssl: process.env.NODE_ENV === 'production' ? {
        require: true,
        rejectUnauthorized: false
      } : false,
      keepAlive: true,
      keepAliveInitialDelayMillis: 2000
    },
    retry: {
      max: 5,
      backoffBase: 1000,
      backoffExponent: 1.5
    }
  };

  // DigitalOcean provides DATABASE_URL in the format:
  // postgresql://username:password@host:port/database?sslmode=require
  if (process.env.DATABASE_URL) {
    return new Sequelize(process.env.DATABASE_URL, config);
  }

  // Fallback for local development
  return new Sequelize({
    ...config,
    database: process.env.DB_NAME || 'medicare_compliance',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432
  });
};

const sequelize = getDatabaseConfig();

const connectDatabase = async () => {
  try {
    await sequelize.authenticate();
    logger.info('✅ PostgreSQL connection established successfully');
    logger.info(`📊 Database: ${sequelize.config.database}`);
    logger.info(`🏢 Host: ${sequelize.config.host || 'DigitalOcean Managed Database'}`);
    
    // Auto-migrate in development, manual migrations in production
    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync({ alter: true });
      logger.info('📝 Database schema synchronized');
    }
    
    return sequelize;
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    
    // Retry logic for production
    if (process.env.NODE_ENV === 'production') {
      logger.info('🔄 Retrying database connection in 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      return connectDatabase();
    }
    
    throw error;
  }
};

// Health check for database
const checkDatabaseHealth = async () => {
  try {
    await sequelize.query('SELECT 1', { type: Sequelize.QueryTypes.SELECT });
    return { status: 'healthy', latency: await getLatency() };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
};

const getLatency = async () => {
  const start = Date.now();
  await sequelize.query('SELECT 1', { type: Sequelize.QueryTypes.SELECT });
  return Date.now() - start;
};

// Graceful shutdown
const closeDatabaseConnection = async () => {
  try {
    await sequelize.close();
    logger.info('✅ Database connection closed gracefully');
  } catch (error) {
    logger.error('❌ Error closing database connection:', error);
  }
};

module.exports = {
  sequelize,
  connectDatabase,
  checkDatabaseHealth,
  closeDatabaseConnection,
  Sequelize
};