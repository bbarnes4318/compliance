const tf = require('@tensorflow/tfjs-node');
const natural = require('natural');
const { FWAIncident } = require('../models/FWAIncident');
const { logger } = require('../utils/logger');
const { cacheHelpers } = require('../config/redis');

class FWADetectionService {
  constructor() {
    this.models = {
      textClassifier: null,
      anomalyDetector: null,
      patternMatcher: null
    };
    
    this.fraudKeywords = [
      'fake', 'false', 'fraudulent', 'scam', 'cheat', 'steal', 'unauthorized',
      'identity theft', 'stolen', 'forged', 'duplicate', 'ghost', 'phantom',
      'kickback', 'bribe', 'corruption', 'manipulation', 'deceive'
    ];
    
    this.suspiciousPatterns = {
      billing: [
        /billing\s+for\s+services?\s+not\s+provided/i,
        /up\s*cod(ing|ed)/i,
        /ghost\s+patient/i,
        /phantom\s+billing/i,
        /duplicate\s+claims?/i
      ],
      enrollment: [
        /unauthorized\s+enrollment/i,
        /enrollment\s+without\s+consent/i,
        /fake\s+beneficiary/i,
        /identity\s+theft/i,
        /stolen\s+medicare\s+number/i
      ],
      benefits: [
        /misrepresent(ed|ing)\s+benefits?/i,
        /false\s+information\s+about/i,
        /exaggerat(ed|ing)\s+coverage/i,
        /misleading\s+marketing/i
      ]
    };
    
    this.riskThresholds = {
      LOW: 0.3,
      MEDIUM: 0.6,
      HIGH: 0.8,
      CRITICAL: 0.9
    };
    
    this.initializeModels();
  }
  
  async initializeModels() {
    try {
      // In production, load pre-trained models
      // For now, we'll simulate model initialization
      logger.info('🤖 Initializing AI/ML models for FWA detection');
      
      // Text classifier for identifying FWA-related content
      this.models.textClassifier = await this.createTextClassifier();
      
      // Anomaly detector for unusual patterns
      this.models.anomalyDetector = await this.createAnomalyDetector();
      
      // Pattern matcher for known fraud patterns
      this.models.patternMatcher = this.createPatternMatcher();
      
      logger.info('✅ FWA detection models initialized successfully');
    } catch (error) {
      logger.error('❌ Error initializing FWA detection models:', error);
      throw error;
    }
  }
  
  async createTextClassifier() {
    // Create a simple neural network for text classification
    const model = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [100], units: 64, activation: 'relu' }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 32, activation: 'relu' }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 16, activation: 'relu' }),
        tf.layers.dense({ units: 4, activation: 'softmax' }) // 4 classes: Normal, Fraud, Waste, Abuse
      ]
    });
    
    model.compile({
      optimizer: 'adam',
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });
    
    return model;
  }
  
  async createAnomalyDetector() {
    // Simple autoencoder for anomaly detection
    const encoder = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [50], units: 25, activation: 'relu' }),
        tf.layers.dense({ units: 12, activation: 'relu' }),
        tf.layers.dense({ units: 6, activation: 'relu' })
      ]
    });
    
    const decoder = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [6], units: 12, activation: 'relu' }),
        tf.layers.dense({ units: 25, activation: 'relu' }),
        tf.layers.dense({ units: 50, activation: 'sigmoid' })
      ]
    });
    
    const autoencoder = tf.sequential({
      layers: [encoder, decoder]
    });
    
    autoencoder.compile({
      optimizer: 'adam',
      loss: 'meanSquaredError'
    });
    
    return { autoencoder, encoder };
  }
  
  createPatternMatcher() {
    return {
      analyzeText: (text) => {
        const patterns = [];
        const lowerText = text.toLowerCase();
        
        // Check for suspicious patterns
        Object.entries(this.suspiciousPatterns).forEach(([category, regexes]) => {
          regexes.forEach(regex => {
            if (regex.test(text)) {
              patterns.push({
                category,
                pattern: regex.source,
                confidence: 0.85
              });
            }
          });
        });
        
        // Check for fraud keywords
        const fraudKeywordCount = this.fraudKeywords.filter(keyword => 
          lowerText.includes(keyword)
        ).length;
        
        if (fraudKeywordCount > 0) {
          patterns.push({
            category: 'keyword_match',
            count: fraudKeywordCount,
            confidence: Math.min(0.9, fraudKeywordCount * 0.2)
          });
        }
        
        return patterns;
      }
    };
  }
  
  async analyzeCallTranscript(transcript, metadata = {}) {
    try {
      logger.info('🔍 Analyzing call transcript for FWA patterns');
      
      const analysis = {
        confidence: 0,
        riskLevel: 'LOW',
        indicators: [],
        patterns: [],
        recommendations: [],
        metadata: {
          ...metadata,
          analyzedAt: new Date(),
          textLength: transcript.length
        }
      };
      
      // Text preprocessing
      const cleanedText = this.preprocessText(transcript);
      const tokens = natural.WordTokenizer.tokenize(cleanedText);
      const sentiment = natural.SentimentAnalyzer.getSentiment(tokens);
      
      // Pattern matching analysis
      const patterns = this.models.patternMatcher.analyzeText(transcript);
      analysis.patterns = patterns;
      
      // Calculate base confidence from patterns
      let patternConfidence = 0;
      patterns.forEach(pattern => {
        patternConfidence = Math.max(patternConfidence, pattern.confidence);
      });
      
      // Text classification (simulated)
      const textFeatures = this.extractTextFeatures(cleanedText);
      const classificationResult = await this.classifyText(textFeatures);
      
      // Sentiment analysis impact
      const sentimentImpact = sentiment < -0.3 ? 0.2 : 0;
      
      // Calculate final confidence score
      analysis.confidence = Math.min(1.0, 
        patternConfidence * 0.5 + 
        classificationResult.confidence * 0.4 + 
        sentimentImpact
      );
      
      // Determine risk level
      analysis.riskLevel = this.determineRiskLevel(analysis.confidence);
      
      // Generate indicators
      analysis.indicators = this.generateIndicators(patterns, sentiment, classificationResult);
      
      // Generate recommendations
      analysis.recommendations = this.generateRecommendations(analysis);
      
      // Cache analysis for future reference
      await cacheHelpers.setWithExpiry(
        `fwa_analysis:${metadata.callId || 'unknown'}`,
        analysis,
        3600
      );
      
      logger.info(`📊 FWA Analysis complete: Risk=${analysis.riskLevel}, Confidence=${analysis.confidence.toFixed(3)}`);
      
      return analysis;
      
    } catch (error) {
      logger.error('❌ Error analyzing call transcript:', error);
      throw error;
    }
  }
  
  async analyzeBillingPattern(billingData) {
    try {
      logger.info('💰 Analyzing billing patterns for anomalies');
      
      const analysis = {
        confidence: 0,
        riskLevel: 'LOW',
        anomalies: [],
        patterns: [],
        statisticalAnalysis: {},
        recommendations: []
      };
      
      // Statistical analysis
      const stats = this.calculateBillingStatistics(billingData);
      analysis.statisticalAnalysis = stats;
      
      // Anomaly detection
      const anomalies = this.detectBillingAnomalies(billingData, stats);
      analysis.anomalies = anomalies;
      
      // Pattern recognition
      const patterns = this.detectBillingPatterns(billingData);
      analysis.patterns = patterns;
      
      // Calculate confidence based on anomalies and patterns
      const anomalyScore = anomalies.length > 0 ? 
        Math.min(1.0, anomalies.reduce((sum, a) => sum + a.severity, 0) / 10) : 0;
      
      const patternScore = patterns.length > 0 ?
        Math.min(1.0, patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length) : 0;
      
      analysis.confidence = Math.max(anomalyScore, patternScore);
      analysis.riskLevel = this.determineRiskLevel(analysis.confidence);
      
      // Generate recommendations
      analysis.recommendations = this.generateBillingRecommendations(analysis);
      
      return analysis;
      
    } catch (error) {
      logger.error('❌ Error analyzing billing patterns:', error);
      throw error;
    }
  }
  
  async analyzeEnrollmentActivity(enrollmentData) {
    try {
      logger.info('📋 Analyzing enrollment activity for suspicious patterns');
      
      const analysis = {
        confidence: 0,
        riskLevel: 'LOW',
        suspiciousActivities: [],
        consentViolations: [],
        identityRisks: [],
        recommendations: []
      };
      
      // Check for consent violations
      const consentViolations = this.detectConsentViolations(enrollmentData);
      analysis.consentViolations = consentViolations;
      
      // Identity verification risks
      const identityRisks = this.assessIdentityRisks(enrollmentData);
      analysis.identityRisks = identityRisks;
      
      // Suspicious activity patterns
      const suspiciousActivities = this.detectSuspiciousEnrollmentPatterns(enrollmentData);
      analysis.suspiciousActivities = suspiciousActivities;
      
      // Calculate confidence
      const violationScore = consentViolations.length * 0.3;
      const identityScore = identityRisks.length * 0.4;
      const activityScore = suspiciousActivities.length * 0.2;
      
      analysis.confidence = Math.min(1.0, violationScore + identityScore + activityScore);
      analysis.riskLevel = this.determineRiskLevel(analysis.confidence);
      
      analysis.recommendations = this.generateEnrollmentRecommendations(analysis);
      
      return analysis;
      
    } catch (error) {
      logger.error('❌ Error analyzing enrollment activity:', error);
      throw error;
    }
  }
  
  async reportFWAIncident(analysisResult, source, reporterId = null) {
    try {
      if (analysisResult.confidence < this.riskThresholds.LOW) {
        logger.info('🔍 Analysis below reporting threshold, logging for monitoring');
        return null;
      }
      
      const incidentType = this.determineIncidentType(analysisResult);
      const severity = this.mapRiskToSeverity(analysisResult.riskLevel);
      
      const incident = await FWAIncident.create({
        incident_type: incidentType,
        severity: severity,
        detection_method: 'AI_DETECTION',
        reporter_type: reporterId ? 'EMPLOYEE' : 'SYSTEM',
        reporter_id: reporterId,
        incident_date: new Date(),
        description: this.generateIncidentDescription(analysisResult, source),
        ai_confidence_score: analysisResult.confidence,
        ai_analysis: analysisResult,
        risk_score: Math.round(analysisResult.confidence * 100),
        metadata: {
          source,
          detection_timestamp: new Date(),
          analyzer_version: '1.0.0'
        }
      });
      
      logger.info(`🚨 FWA Incident created: ${incident.incident_number} (Risk: ${severity})`);
      
      // Auto-escalate critical incidents
      if (severity === 'CRITICAL') {
        await this.autoEscalateIncident(incident);
      }
      
      return incident;
      
    } catch (error) {
      logger.error('❌ Error reporting FWA incident:', error);
      throw error;
    }
  }
  
  // Helper methods
  preprocessText(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  extractTextFeatures(text) {
    const tokens = natural.WordTokenizer.tokenize(text);
    const stemmer = natural.PorterStemmer;
    const stemmedTokens = tokens.map(token => stemmer.stem(token));
    
    // Create feature vector (simplified)
    const features = new Array(100).fill(0);
    
    stemmedTokens.forEach((token, index) => {
      if (index < 100) {
        features[index] = token.length / 10; // Normalize
      }
    });
    
    return features;
  }
  
  async classifyText(features) {
    // Simplified classification - in production use trained model
    const fraudScore = features.reduce((sum, val, idx) => {
      return sum + (this.fraudKeywords.some(keyword => keyword.includes(String(idx))) ? val : 0);
    }, 0) / features.length;
    
    return {
      confidence: Math.min(0.95, fraudScore * 2),
      class: fraudScore > 0.5 ? 'FRAUD' : 'NORMAL'
    };
  }
  
  determineRiskLevel(confidence) {
    if (confidence >= this.riskThresholds.CRITICAL) return 'CRITICAL';
    if (confidence >= this.riskThresholds.HIGH) return 'HIGH';
    if (confidence >= this.riskThresholds.MEDIUM) return 'MEDIUM';
    return 'LOW';
  }
  
  generateIndicators(patterns, sentiment, classification) {
    const indicators = [];
    
    patterns.forEach(pattern => {
      indicators.push({
        type: 'PATTERN_MATCH',
        category: pattern.category,
        confidence: pattern.confidence,
        description: `Suspicious ${pattern.category} pattern detected`
      });
    });
    
    if (sentiment < -0.3) {
      indicators.push({
        type: 'SENTIMENT',
        confidence: Math.abs(sentiment),
        description: 'Negative sentiment detected in communication'
      });
    }
    
    if (classification.class === 'FRAUD') {
      indicators.push({
        type: 'AI_CLASSIFICATION',
        confidence: classification.confidence,
        description: 'AI model classified content as potentially fraudulent'
      });
    }
    
    return indicators;
  }
  
  generateRecommendations(analysis) {
    const recommendations = [];
    
    if (analysis.riskLevel === 'CRITICAL') {
      recommendations.push({
        priority: 'IMMEDIATE',
        action: 'Initiate emergency investigation',
        description: 'Critical risk level detected - immediate action required'
      });
    }
    
    if (analysis.patterns.some(p => p.category === 'billing')) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Review billing records',
        description: 'Billing irregularities detected - conduct detailed audit'
      });
    }
    
    if (analysis.confidence > 0.7) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Flag for compliance review',
        description: 'High confidence FWA detection - requires human review'
      });
    }
    
    return recommendations;
  }
  
  // Billing analysis methods
  calculateBillingStatistics(billingData) {
    if (!billingData || billingData.length === 0) return {};
    
    const amounts = billingData.map(b => b.amount || 0);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      count: billingData.length,
      mean,
      median: amounts.sort((a, b) => a - b)[Math.floor(amounts.length / 2)],
      stdDev,
      min: Math.min(...amounts),
      max: Math.max(...amounts)
    };
  }
  
  detectBillingAnomalies(billingData, stats) {
    const anomalies = [];
    
    billingData.forEach(bill => {
      const zScore = Math.abs((bill.amount - stats.mean) / stats.stdDev);
      
      if (zScore > 3) { // 3 standard deviations
        anomalies.push({
          type: 'STATISTICAL_OUTLIER',
          billId: bill.id,
          amount: bill.amount,
          zScore,
          severity: zScore > 4 ? 0.9 : 0.7,
          description: `Amount significantly deviates from normal pattern`
        });
      }
    });
    
    return anomalies;
  }
  
  detectBillingPatterns(billingData) {
    const patterns = [];
    
    // Check for duplicate billing
    const amounts = billingData.map(b => b.amount);
    const duplicates = amounts.filter((amount, index) => 
      amounts.indexOf(amount) !== index
    );
    
    if (duplicates.length > 0) {
      patterns.push({
        type: 'DUPLICATE_AMOUNTS',
        count: duplicates.length,
        confidence: 0.8,
        description: 'Multiple bills with identical amounts detected'
      });
    }
    
    return patterns;
  }
  
  // Additional helper methods would be implemented here...
  
  determineIncidentType(analysisResult) {
    if (analysisResult.patterns.some(p => p.category === 'billing')) {
      return 'BILLING_IRREGULARITY';
    }
    if (analysisResult.patterns.some(p => p.category === 'enrollment')) {
      return 'ENROLLMENT_MANIPULATION';
    }
    if (analysisResult.patterns.some(p => p.category === 'benefits')) {
      return 'BENEFIT_MISREPRESENTATION';
    }
    return 'SUSPICIOUS_ACTIVITY';
  }
  
  mapRiskToSeverity(riskLevel) {
    const mapping = {
      'LOW': 'LOW',
      'MEDIUM': 'MEDIUM',
      'HIGH': 'HIGH',
      'CRITICAL': 'CRITICAL'
    };
    return mapping[riskLevel] || 'MEDIUM';
  }
  
  generateIncidentDescription(analysisResult, source) {
    const patterns = analysisResult.patterns.map(p => p.category).join(', ');
    const confidence = (analysisResult.confidence * 100).toFixed(1);
    
    return `AI-detected suspicious activity in ${source}. ` +
           `Confidence: ${confidence}%. Patterns: ${patterns}. ` +
           `Risk Level: ${analysisResult.riskLevel}.`;
  }
  
  async autoEscalateIncident(incident) {
    // Auto-escalation logic for critical incidents
    logger.warn(`🚨 AUTO-ESCALATING CRITICAL INCIDENT: ${incident.incident_number}`);
    
    // Would integrate with notification systems
    // await notificationService.sendCriticalAlert(incident);
    // await complianceOfficerNotification(incident);
  }
}

module.exports = new FWADetectionService();