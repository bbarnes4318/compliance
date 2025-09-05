const redis = require('redis');
const { logger } = require('../utils/logger');

let redisClient = null;

const initializeRedis = async () => {
  try {
    // DigitalOcean provides REDIS_URL in the format:
    // rediss://default:password@host:port
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = redis.createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10000,
        keepAlive: 5000,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('❌ Redis: Max reconnection attempts reached');
            return new Error('Max reconnection attempts reached');
          }
          const delay = Math.min(retries * 100, 3000);
          logger.info(`🔄 Redis: Reconnecting in ${delay}ms...`);
          return delay;
        }
      },
      // DigitalOcean Managed Redis uses TLS
      ...(process.env.NODE_ENV === 'production' && {
        socket: {
          tls: true,
          rejectUnauthorized: false
        }
      })
    });

    redisClient.on('error', (err) => {
      logger.error('❌ Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('🔗 Redis: Connecting...');
    });

    redisClient.on('ready', () => {
      logger.info('✅ Redis: Connection established and ready');
    });

    redisClient.on('reconnecting', () => {
      logger.warn('🔄 Redis: Reconnecting...');
    });

    await redisClient.connect();
    
    // Test the connection
    await redisClient.ping();
    
    // Set default TTL for cache entries (1 hour)
    redisClient.defaultTTL = 3600;
    
    return redisClient;
  } catch (error) {
    logger.error('❌ Redis initialization failed:', error);
    
    // In production, we want to continue even if Redis fails
    // but log the error and potentially use in-memory fallback
    if (process.env.NODE_ENV === 'production') {
      logger.warn('⚠️ Running without Redis cache - using in-memory fallback');
      return createInMemoryCache();
    }
    
    throw error;
  }
};

// In-memory cache fallback for when Redis is unavailable
const createInMemoryCache = () => {
  const cache = new Map();
  const timers = new Map();
  
  return {
    async get(key) {
      return cache.get(key);
    },
    
    async set(key, value, ttl = 3600) {
      cache.set(key, value);
      
      // Clear existing timer if any
      if (timers.has(key)) {
        clearTimeout(timers.get(key));
      }
      
      // Set new timer for TTL
      const timer = setTimeout(() => {
        cache.delete(key);
        timers.delete(key);
      }, ttl * 1000);
      
      timers.set(key, timer);
      return 'OK';
    },
    
    async del(key) {
      if (timers.has(key)) {
        clearTimeout(timers.get(key));
        timers.delete(key);
      }
      return cache.delete(key) ? 1 : 0;
    },
    
    async exists(key) {
      return cache.has(key) ? 1 : 0;
    },
    
    async expire(key, seconds) {
      if (!cache.has(key)) return 0;
      
      const value = cache.get(key);
      await this.set(key, value, seconds);
      return 1;
    },
    
    async ttl(key) {
      // In-memory cache doesn't track TTL precisely
      return cache.has(key) ? 1 : -2;
    },
    
    async flushAll() {
      timers.forEach(timer => clearTimeout(timer));
      cache.clear();
      timers.clear();
      return 'OK';
    },
    
    async ping() {
      return 'PONG';
    },
    
    isInMemory: true
  };
};

// Cache helper functions
const cacheHelpers = {
  async getCached(key, fetchFunction, ttl = 3600) {
    try {
      const cached = await redisClient.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
      
      const data = await fetchFunction();
      await redisClient.set(key, JSON.stringify(data), { EX: ttl });
      return data;
    } catch (error) {
      logger.error('Cache operation failed:', error);
      // Fallback to direct fetch if cache fails
      return await fetchFunction();
    }
  },
  
  async invalidatePattern(pattern) {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      return keys.length;
    } catch (error) {
      logger.error('Cache invalidation failed:', error);
      return 0;
    }
  },
  
  async setWithExpiry(key, value, ttl = 3600) {
    try {
      return await redisClient.set(key, JSON.stringify(value), { EX: ttl });
    } catch (error) {
      logger.error('Cache set operation failed:', error);
      return null;
    }
  }
};

// Session store for Express
const createSessionStore = () => {
  if (!redisClient || redisClient.isInMemory) {
    logger.warn('⚠️ Using in-memory session store - not suitable for production');
    return null;
  }
  
  const MongoStore = require('connect-mongo');
  const RedisStore = require('connect-redis').default;
  
  return new RedisStore({
    client: redisClient,
    prefix: 'sess:',
    ttl: 86400 // 24 hours
  });
};

// Health check for Redis
const checkRedisHealth = async () => {
  try {
    if (!redisClient) {
      return { status: 'unavailable', message: 'Redis client not initialized' };
    }
    
    const start = Date.now();
    await redisClient.ping();
    const latency = Date.now() - start;
    
    return { 
      status: 'healthy', 
      latency,
      isInMemory: redisClient.isInMemory || false
    };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
};

// Graceful shutdown
const closeRedisConnection = async () => {
  try {
    if (redisClient && !redisClient.isInMemory) {
      await redisClient.quit();
      logger.info('✅ Redis connection closed gracefully');
    }
  } catch (error) {
    logger.error('❌ Error closing Redis connection:', error);
  }
};

module.exports = {
  initializeRedis,
  getRedisClient: () => redisClient,
  cacheHelpers,
  createSessionStore,
  checkRedisHealth,
  closeRedisConnection
};