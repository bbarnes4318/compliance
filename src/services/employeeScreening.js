const axios = require('axios');
const cheerio = require('cheerio');
const { Employee } = require('../models/Employee');
const { logger } = require('../utils/logger');
const { cacheHelpers } = require('../config/redis');

class EmployeeScreeningService {
  constructor() {
    this.oigApiUrl = 'https://oig.hhs.gov/exclusions/exclusions_list.asp';
    this.samApiUrl = 'https://sam.gov/api/prod/entityinformation/v3/entities';
    this.providerTrustApiUrl = process.env.PROVIDERTRUST_API_URL;
    this.providerTrustApiKey = process.env.PROVIDERTRUST_API_KEY;
    
    this.screeningFrequency = 30; // days
    this.batchSize = 50; // employees per batch
    
    // Screening data sources
    this.dataSources = {
      OIG_LEIE: {
        name: 'OIG List of Excluded Individuals/Entities',
        url: 'https://oig.hhs.gov/exclusions/',
        required: true,
        frequency: 30
      },
      GSA_SAM: {
        name: 'GSA System for Award Management',
        url: 'https://sam.gov/',
        required: true,
        frequency: 30
      },
      NPDB: {
        name: 'National Practitioner Data Bank',
        url: 'https://www.npdb.hrsa.gov/',
        required: false,
        frequency: 90
      },
      OIG_SANCTIONS: {
        name: 'OIG Sanctions Database',
        url: 'https://oig.hhs.gov/',
        required: true,
        frequency: 30
      }
    };
  }
  
  async performPreHireScreening(employeeData) {
    try {
      logger.info(`🔍 Performing pre-hire screening for: ${employeeData.first_name} ${employeeData.last_name}`);
      
      const screeningResult = {
        employeeId: employeeData.employee_id,
        screeningDate: new Date(),
        status: 'PENDING',
        results: {},
        overallResult: 'PENDING',
        exclusionFound: false,
        details: [],
        nextScreeningDate: null
      };
      
      // Screen against all required databases
      const screeningPromises = [
        this.screenAgainstOIG(employeeData),
        this.screenAgainstGSA(employeeData),
        this.screenWithProviderTrust(employeeData)
      ];
      
      const results = await Promise.allSettled(screeningPromises);
      
      // Process results
      results.forEach((result, index) => {
        const sourceName = ['OIG_LEIE', 'GSA_SAM', 'PROVIDER_TRUST'][index];
        
        if (result.status === 'fulfilled') {
          screeningResult.results[sourceName] = result.value;
          
          if (result.value.exclusionFound) {
            screeningResult.exclusionFound = true;
            screeningResult.details.push(...result.value.details);
          }
        } else {
          screeningResult.results[sourceName] = {
            status: 'ERROR',
            error: result.reason.message,
            exclusionFound: false
          };
        }
      });
      
      // Determine overall result
      if (screeningResult.exclusionFound) {
        screeningResult.overallResult = 'EXCLUDED';
        screeningResult.status = 'FAILED';
      } else if (Object.values(screeningResult.results).every(r => r.status === 'CLEAR')) {
        screeningResult.overallResult = 'CLEAR';
        screeningResult.status = 'APPROVED';
      } else {
        screeningResult.overallResult = 'NEEDS_REVIEW';
        screeningResult.status = 'PENDING';
      }
      
      // Set next screening date
      const nextScreening = new Date();
      nextScreening.setDate(nextScreening.getDate() + this.screeningFrequency);
      screeningResult.nextScreeningDate = nextScreening;
      
      // Store screening result
      await this.storeScreeningResult(employeeData.employee_id, screeningResult);
      
      logger.info(`✅ Pre-hire screening completed: ${employeeData.employee_id} - ${screeningResult.overallResult}`);
      
      return screeningResult;
      
    } catch (error) {
      logger.error('❌ Error in pre-hire screening:', error);
      throw error;
    }
  }
  
  async performMonthlyScreening() {
    try {
      logger.info('📅 Starting monthly employee screening process');
      
      const employeesNeedingScreening = await Employee.getEmployeesNeedingScreening();
      
      if (employeesNeedingScreening.length === 0) {
        logger.info('✅ No employees need screening at this time');
        return { processed: 0, results: [] };
      }
      
      logger.info(`👥 Found ${employeesNeedingScreening.length} employees needing screening`);
      
      const results = [];
      
      // Process in batches to avoid overwhelming APIs
      for (let i = 0; i < employeesNeedingScreening.length; i += this.batchSize) {
        const batch = employeesNeedingScreening.slice(i, i + this.batchSize);
        
        const batchPromises = batch.map(employee => 
          this.performEmployeeScreening(employee).catch(error => ({
            employeeId: employee.employee_id,
            error: error.message,
            status: 'ERROR'
          }))
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Rate limiting - wait between batches
        if (i + this.batchSize < employeesNeedingScreening.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Process results and update employee records
      let exclusionsFound = 0;
      for (const result of results) {
        if (result.exclusionFound) {
          exclusionsFound++;
          await this.handleExclusionFound(result);
        }
        
        // Update employee screening dates
        if (result.status !== 'ERROR') {
          await Employee.update({
            last_screening_date: new Date(),
            next_screening_date: result.nextScreeningDate,
            excluded_status: result.exclusionFound,
            exclusion_details: result.exclusionFound ? result.details : null
          }, {
            where: { employee_id: result.employeeId }
          });
        }
      }
      
      logger.info(`✅ Monthly screening completed: ${results.length} processed, ${exclusionsFound} exclusions found`);
      
      return {
        processed: results.length,
        exclusionsFound,
        results: results.filter(r => r.exclusionFound || r.status === 'ERROR')
      };
      
    } catch (error) {
      logger.error('❌ Error in monthly screening:', error);
      throw error;
    }
  }
  
  async performEmployeeScreening(employee) {
    try {
      const employeeData = {
        employee_id: employee.employee_id,
        first_name: employee.first_name,
        last_name: employee.last_name,
        ssn_last_four: employee.ssn_last_four,
        date_of_birth: employee.date_of_birth
      };
      
      return await this.performPreHireScreening(employeeData);
      
    } catch (error) {
      logger.error(`❌ Error screening employee ${employee.employee_id}:`, error);
      throw error;
    }
  }
  
  async screenAgainstOIG(employeeData) {
    try {
      logger.debug(`🔍 Screening ${employeeData.employee_id} against OIG LEIE`);
      
      // Check cache first
      const cacheKey = `oig_screen:${employeeData.first_name}:${employeeData.last_name}:${employeeData.ssn_last_four}`;
      const cached = await cacheHelpers.getCached(cacheKey, null, 3600);
      
      if (cached) {
        logger.debug('📦 Using cached OIG screening result');
        return cached;
      }
      
      const result = {
        source: 'OIG_LEIE',
        status: 'CLEAR',
        exclusionFound: false,
        details: [],
        screeningDate: new Date()
      };
      
      // In production, this would make actual API calls to OIG
      // For now, simulating the screening process
      const oigResult = await this.mockOIGScreening(employeeData);
      
      if (oigResult.exclusionFound) {
        result.status = 'EXCLUDED';
        result.exclusionFound = true;
        result.details = oigResult.details;
      }
      
      // Cache result
      await cacheHelpers.setWithExpiry(cacheKey, result, 3600);
      
      return result;
      
    } catch (error) {
      logger.error('❌ Error screening against OIG:', error);
      return {
        source: 'OIG_LEIE',
        status: 'ERROR',
        exclusionFound: false,
        error: error.message,
        screeningDate: new Date()
      };
    }
  }
  
  async screenAgainstGSA(employeeData) {
    try {
      logger.debug(`🔍 Screening ${employeeData.employee_id} against GSA SAM`);
      
      const cacheKey = `gsa_screen:${employeeData.first_name}:${employeeData.last_name}`;
      const cached = await cacheHelpers.getCached(cacheKey, null, 3600);
      
      if (cached) {
        return cached;
      }
      
      const result = {
        source: 'GSA_SAM',
        status: 'CLEAR',
        exclusionFound: false,
        details: [],
        screeningDate: new Date()
      };
      
      // Mock GSA screening
      const gsaResult = await this.mockGSAScreening(employeeData);
      
      if (gsaResult.exclusionFound) {
        result.status = 'EXCLUDED';
        result.exclusionFound = true;
        result.details = gsaResult.details;
      }
      
      await cacheHelpers.setWithExpiry(cacheKey, result, 3600);
      
      return result;
      
    } catch (error) {
      logger.error('❌ Error screening against GSA:', error);
      return {
        source: 'GSA_SAM',
        status: 'ERROR',
        exclusionFound: false,
        error: error.message,
        screeningDate: new Date()
      };
    }
  }
  
  async screenWithProviderTrust(employeeData) {
    try {
      if (!this.providerTrustApiKey) {
        logger.warn('⚠️ ProviderTrust API key not configured, skipping');
        return {
          source: 'PROVIDER_TRUST',
          status: 'SKIPPED',
          exclusionFound: false,
          screeningDate: new Date()
        };
      }
      
      logger.debug(`🔍 Screening ${employeeData.employee_id} with ProviderTrust`);
      
      const response = await axios.post(`${this.providerTrustApiUrl}/screening`, {
        firstName: employeeData.first_name,
        lastName: employeeData.last_name,
        dateOfBirth: employeeData.date_of_birth,
        ssnLastFour: employeeData.ssn_last_four
      }, {
        headers: {
          'Authorization': `Bearer ${this.providerTrustApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      const result = {
        source: 'PROVIDER_TRUST',
        status: response.data.status,
        exclusionFound: response.data.exclusionFound || false,
        details: response.data.matches || [],
        confidence: response.data.confidence,
        screeningDate: new Date(),
        reportId: response.data.reportId
      };
      
      return result;
      
    } catch (error) {
      logger.error('❌ Error screening with ProviderTrust:', error);
      return {
        source: 'PROVIDER_TRUST',
        status: 'ERROR',
        exclusionFound: false,
        error: error.message,
        screeningDate: new Date()
      };
    }
  }
  
  async handleExclusionFound(screeningResult) {
    try {
      logger.warn(`🚨 EXCLUSION FOUND: ${screeningResult.employeeId}`);
      
      const employee = await Employee.findOne({
        where: { employee_id: screeningResult.employeeId }
      });
      
      if (employee) {
        // Immediately suspend employee
        await employee.update({
          status: 'SUSPENDED',
          excluded_status: true,
          exclusion_details: screeningResult.details
        });
        
        // Create incident report
        const incidentData = {
          type: 'OIG_EXCLUSION_DETECTED',
          employee_id: screeningResult.employeeId,
          details: screeningResult.details,
          severity: 'CRITICAL',
          requires_immediate_action: true
        };
        
        // Send immediate notifications
        await this.sendExclusionAlert(employee, screeningResult);
        
        logger.error(`🚨 Employee ${screeningResult.employeeId} suspended due to exclusion`);
      }
      
    } catch (error) {
      logger.error('❌ Error handling exclusion:', error);
    }
  }
  
  async sendExclusionAlert(employee, screeningResult) {
    try {
      // In production, integrate with notification system
      logger.warn(`🚨 ALERT: Exclusion detected for ${employee.first_name} ${employee.last_name}`);
      logger.warn(`Details: ${JSON.stringify(screeningResult.details)}`);
      
      // Would send emails, Slack notifications, etc.
      
    } catch (error) {
      logger.error('❌ Error sending exclusion alert:', error);
    }
  }
  
  async storeScreeningResult(employeeId, result) {
    try {
      const storageKey = `screening_result:${employeeId}:${Date.now()}`;
      await cacheHelpers.setWithExpiry(storageKey, result, 86400 * 30); // 30 days
      
      // Also store in employee record
      const employee = await Employee.findOne({
        where: { employee_id: employeeId }
      });
      
      if (employee) {
        const screeningHistory = employee.metadata?.screeningHistory || [];
        screeningHistory.push(result);
        
        // Keep last 12 screening results
        if (screeningHistory.length > 12) {
          screeningHistory.shift();
        }
        
        await employee.update({
          metadata: {
            ...employee.metadata,
            screeningHistory,
            lastScreeningResult: result
          }
        });
      }
      
    } catch (error) {
      logger.error('❌ Error storing screening result:', error);
    }
  }
  
  // Mock screening functions (replace with real API calls in production)
  async mockOIGScreening(employeeData) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
    
    // Simulate very low chance of exclusion (1%)
    const isExcluded = Math.random() < 0.01;
    
    if (isExcluded) {
      return {
        exclusionFound: true,
        details: [{
          name: `${employeeData.first_name} ${employeeData.last_name}`,
          exclusionType: 'Convicted of a criminal offense',
          exclusionDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000),
          reinstateDate: null,
          waiverDate: null
        }]
      };
    }
    
    return { exclusionFound: false, details: [] };
  }
  
  async mockGSAScreening(employeeData) {
    await new Promise(resolve => setTimeout(resolve, Math.random() * 800 + 300));
    
    const isExcluded = Math.random() < 0.005; // Even lower chance for GSA
    
    if (isExcluded) {
      return {
        exclusionFound: true,
        details: [{
          name: `${employeeData.first_name} ${employeeData.last_name}`,
          exclusionType: 'Debarment',
          exclusionDate: new Date(Date.now() - Math.random() * 200 * 24 * 60 * 60 * 1000),
          agencyCode: 'HHS'
        }]
      };
    }
    
    return { exclusionFound: false, details: [] };
  }
  
  async generateScreeningReport(options = {}) {
    try {
      logger.info('📊 Generating employee screening report');
      
      const { startDate, endDate } = options;
      
      const where = { status: 'ACTIVE' };
      if (startDate || endDate) {
        where.last_screening_date = {};
        if (startDate) where.last_screening_date[Employee.sequelize.Op.gte] = startDate;
        if (endDate) where.last_screening_date[Employee.sequelize.Op.lte] = endDate;
      }
      
      const [
        totalEmployees,
        excludedEmployees,
        needingScreening,
        screeningCompliance
      ] = await Promise.all([
        Employee.count({ where }),
        Employee.getExcludedEmployees(),
        Employee.getEmployeesNeedingScreening(),
        this.calculateScreeningCompliance()
      ]);
      
      const report = {
        generatedAt: new Date(),
        parameters: options,
        summary: {
          totalActiveEmployees: totalEmployees,
          excludedEmployees: excludedEmployees.length,
          needingScreening: needingScreening.length,
          complianceRate: screeningCompliance.rate,
          lastScreeningRun: screeningCompliance.lastRun
        },
        details: {
          excludedEmployees: excludedEmployees.map(emp => ({
            employeeId: emp.employee_id,
            name: `${emp.first_name} ${emp.last_name}`,
            exclusionDetails: emp.exclusion_details,
            supervisorEmail: emp.Supervisor?.email
          })),
          pendingScreening: needingScreening.map(emp => ({
            employeeId: emp.employee_id,
            name: `${emp.first_name} ${emp.last_name}`,
            nextScreeningDate: emp.next_screening_date,
            daysPastDue: emp.next_screening_date ? 
              Math.ceil((new Date() - new Date(emp.next_screening_date)) / (1000 * 60 * 60 * 24)) : 0
          }))
        }
      };
      
      return report;
      
    } catch (error) {
      logger.error('❌ Error generating screening report:', error);
      throw error;
    }
  }
  
  async calculateScreeningCompliance() {
    try {
      const totalActive = await Employee.count({ where: { status: 'ACTIVE' } });
      const compliant = await Employee.count({
        where: {
          status: 'ACTIVE',
          next_screening_date: {
            [Employee.sequelize.Op.gt]: new Date()
          }
        }
      });
      
      const rate = totalActive > 0 ? (compliant / totalActive * 100).toFixed(2) : 0;
      
      return {
        rate: parseFloat(rate),
        compliant,
        total: totalActive,
        lastRun: new Date() // Would track actual last screening run
      };
      
    } catch (error) {
      logger.error('❌ Error calculating screening compliance:', error);
      return { rate: 0, compliant: 0, total: 0 };
    }
  }
}

module.exports = new EmployeeScreeningService();