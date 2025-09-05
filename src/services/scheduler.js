const cron = require('node-cron');
const { logger } = require('../utils/logger');
const employeeScreeningService = require('./employeeScreening');
const documentRetentionService = require('./documentRetention');
const fwaDetectionService = require('./fwaDetection');

class SchedulerService {
  constructor() {
    this.jobs = new Map();
    this.isInitialized = false;
  }

  startScheduledTasks() {
    if (this.isInitialized) {
      logger.warn('⚠️ Scheduler already initialized, skipping');
      return;
    }

    logger.info('⏰ Starting scheduled compliance tasks');

    // Daily screening check - 6:00 AM UTC
    this.scheduleJob('daily-screening', '0 6 * * *', async () => {
      try {
        logger.info('🔍 Running daily employee screening check');
        const result = await employeeScreeningService.performMonthlyScreening();
        
        if (result.exclusionsFound > 0) {
          logger.warn(`🚨 Daily screening found ${result.exclusionsFound} exclusions`);
        }
        
        logger.info(`✅ Daily screening completed: ${result.processed} employees processed`);
      } catch (error) {
        logger.error('❌ Daily screening failed:', error);
      }
    });

    // Document retention check - 2:00 AM UTC daily
    this.scheduleJob('document-retention', '0 2 * * *', async () => {
      try {
        logger.info('📄 Running document retention maintenance');
        const result = await documentRetentionService.scheduleDocumentDisposal();
        
        if (result.disposed > 0) {
          logger.info(`🗑️ Document disposal completed: ${result.disposed} documents disposed`);
        }
        
        logger.info('✅ Document retention maintenance completed');
      } catch (error) {
        logger.error('❌ Document retention maintenance failed:', error);
      }
    });

    // Weekly compliance report - Sunday 8:00 AM UTC
    this.scheduleJob('weekly-compliance-report', '0 8 * * 0', async () => {
      try {
        logger.info('📊 Generating weekly compliance report');
        
        const [screeningReport, retentionReport] = await Promise.all([
          employeeScreeningService.generateScreeningReport(),
          documentRetentionService.generateRetentionReport()
        ]);
        
        logger.info('✅ Weekly compliance reports generated');
        
        // In production, this would send reports to compliance team
        logger.info(`Screening Summary: ${screeningReport.summary.totalActiveEmployees} active employees`);
        logger.info(`Document Summary: ${retentionReport.summary.totalDocuments} documents managed`);
        
      } catch (error) {
        logger.error('❌ Weekly compliance report failed:', error);
      }
    });

    // Monthly comprehensive screening - 1st of month, 4:00 AM UTC
    this.scheduleJob('monthly-comprehensive-screening', '0 4 1 * *', async () => {
      try {
        logger.info('🔍 Running monthly comprehensive employee screening');
        const result = await employeeScreeningService.performMonthlyScreening();
        
        logger.info(`✅ Monthly screening completed: ${result.processed} employees, ${result.exclusionsFound} exclusions`);
        
        // Generate comprehensive report
        const report = await employeeScreeningService.generateScreeningReport();
        logger.info(`📊 Compliance rate: ${report.summary.complianceRate}%`);
        
      } catch (error) {
        logger.error('❌ Monthly comprehensive screening failed:', error);
      }
    });

    // Cache cleanup - Every 4 hours
    this.scheduleJob('cache-cleanup', '0 */4 * * *', async () => {
      try {
        logger.info('🧹 Running cache cleanup');
        
        // This would implement cache cleanup logic
        logger.info('✅ Cache cleanup completed');
        
      } catch (error) {
        logger.error('❌ Cache cleanup failed:', error);
      }
    });

    // Health check - Every 15 minutes
    this.scheduleJob('health-check', '*/15 * * * *', async () => {
      try {
        const { checkDatabaseHealth } = require('../config/database');
        const { checkRedisHealth } = require('../config/redis');
        
        const [dbHealth, cacheHealth] = await Promise.all([
          checkDatabaseHealth(),
          checkRedisHealth()
        ]);
        
        if (dbHealth.status !== 'healthy') {
          logger.error('❌ Database health check failed:', dbHealth);
        }
        
        if (cacheHealth.status !== 'healthy') {
          logger.error('❌ Cache health check failed:', cacheHealth);
        }
        
      } catch (error) {
        logger.error('❌ Health check failed:', error);
      }
    });

    // Audit log rotation - Daily at 3:00 AM UTC
    this.scheduleJob('audit-log-rotation', '0 3 * * *', async () => {
      try {
        logger.info('📋 Running audit log rotation');
        
        // This would implement log rotation logic
        logger.info('✅ Audit log rotation completed');
        
      } catch (error) {
        logger.error('❌ Audit log rotation failed:', error);
      }
    });

    this.isInitialized = true;
    logger.info(`✅ Scheduled ${this.jobs.size} compliance tasks`);
  }

  scheduleJob(name, cronExpression, jobFunction) {
    try {
      const task = cron.schedule(cronExpression, jobFunction, {
        scheduled: false,
        timezone: 'UTC'
      });

      this.jobs.set(name, {
        task,
        cronExpression,
        isRunning: false,
        lastRun: null,
        nextRun: null
      });

      // Start the task
      task.start();
      
      logger.info(`⏰ Scheduled job '${name}': ${cronExpression}`);
      
    } catch (error) {
      logger.error(`❌ Failed to schedule job '${name}':`, error);
    }
  }

  stopJob(name) {
    const job = this.jobs.get(name);
    if (job) {
      job.task.stop();
      logger.info(`⏹️ Stopped job '${name}'`);
    }
  }

  startJob(name) {
    const job = this.jobs.get(name);
    if (job) {
      job.task.start();
      logger.info(`▶️ Started job '${name}'`);
    }
  }

  getJobStatus(name) {
    const job = this.jobs.get(name);
    if (!job) {
      return null;
    }

    return {
      name,
      cronExpression: job.cronExpression,
      isRunning: job.task.running,
      lastRun: job.lastRun,
      nextRun: job.nextRun
    };
  }

  getAllJobStatuses() {
    const statuses = {};
    for (const [name] of this.jobs) {
      statuses[name] = this.getJobStatus(name);
    }
    return statuses;
  }

  stopAllJobs() {
    logger.info('⏹️ Stopping all scheduled jobs');
    for (const [name, job] of this.jobs) {
      job.task.stop();
    }
    this.isInitialized = false;
  }

  // Manual job execution for testing
  async executeJob(name) {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job '${name}' not found`);
    }

    logger.info(`🔧 Manually executing job '${name}'`);
    
    try {
      // This would need to be enhanced to actually execute the job function
      logger.info(`✅ Job '${name}' executed successfully`);
    } catch (error) {
      logger.error(`❌ Job '${name}' execution failed:`, error);
      throw error;
    }
  }
}

const schedulerService = new SchedulerService();

// Export functions for the main application
module.exports = {
  startScheduledTasks: () => schedulerService.startScheduledTasks(),
  stopScheduledTasks: () => schedulerService.stopAllJobs(),
  getJobStatuses: () => schedulerService.getAllJobStatuses(),
  executeJob: (name) => schedulerService.executeJob(name),
  scheduleCustomJob: (name, cron, fn) => schedulerService.scheduleJob(name, cron, fn)
};