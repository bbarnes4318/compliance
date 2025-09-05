const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const FWAIncident = sequelize.define('FWAIncident', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  
  incident_number: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: 'Unique incident tracking number'
  },
  
  incident_type: {
    type: DataTypes.ENUM(
      'FRAUD',
      'WASTE', 
      'ABUSE',
      'COMPLIANCE_VIOLATION',
      'SUSPICIOUS_ACTIVITY',
      'IDENTITY_THEFT',
      'BILLING_IRREGULARITY',
      'ENROLLMENT_MANIPULATION',
      'BENEFIT_MISREPRESENTATION',
      'UNAUTHORIZED_DISCLOSURE'
    ),
    allowNull: false
  },
  
  severity: {
    type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
    allowNull: false,
    defaultValue: 'MEDIUM'
  },
  
  status: {
    type: DataTypes.ENUM(
      'REPORTED',
      'UNDER_INVESTIGATION',
      'SUBSTANTIATED',
      'UNSUBSTANTIATED',
      'REFERRED_TO_OIG',
      'REFERRED_TO_CMS',
      'RESOLVED',
      'CLOSED'
    ),
    defaultValue: 'REPORTED',
    allowNull: false
  },
  
  detection_method: {
    type: DataTypes.ENUM(
      'AI_DETECTION',
      'MANUAL_REVIEW',
      'EMPLOYEE_REPORT',
      'BENEFICIARY_COMPLAINT',
      'AUDIT_FINDING',
      'SYSTEM_ALERT',
      'ANONYMOUS_TIP',
      'REGULATORY_NOTICE'
    ),
    allowNull: false
  },
  
  reporter_type: {
    type: DataTypes.ENUM(
      'EMPLOYEE',
      'BENEFICIARY',
      'VENDOR',
      'ANONYMOUS',
      'SYSTEM',
      'AUDITOR',
      'REGULATOR'
    ),
    allowNull: false
  },
  
  reporter_id: {
    type: DataTypes.STRING,
    comment: 'ID of reporter if not anonymous'
  },
  
  reporter_protected: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whistleblower protection status'
  },
  
  reported_date: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  
  incident_date: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'When the incident actually occurred'
  },
  
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  
  affected_beneficiaries: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'List of affected beneficiary IDs'
  },
  
  affected_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  financial_impact: {
    type: DataTypes.DECIMAL(15, 2),
    comment: 'Estimated financial impact in USD'
  },
  
  involved_parties: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Employees, vendors, or entities involved'
  },
  
  evidence: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'References to evidence documents, recordings, etc.'
  },
  
  investigation_notes: {
    type: DataTypes.TEXT
  },
  
  investigation_started: {
    type: DataTypes.DATE
  },
  
  investigation_completed: {
    type: DataTypes.DATE
  },
  
  investigator_id: {
    type: DataTypes.STRING
  },
  
  root_cause: {
    type: DataTypes.TEXT
  },
  
  corrective_actions: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'List of corrective actions taken'
  },
  
  preventive_measures: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Measures to prevent recurrence'
  },
  
  regulatory_reported: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  
  regulatory_report_date: {
    type: DataTypes.DATE
  },
  
  regulatory_case_number: {
    type: DataTypes.STRING
  },
  
  oig_referral: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  
  oig_case_number: {
    type: DataTypes.STRING
  },
  
  false_claims_act_violation: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  
  recovery_amount: {
    type: DataTypes.DECIMAL(15, 2),
    comment: 'Amount recovered if any'
  },
  
  penalties_assessed: {
    type: DataTypes.DECIMAL(15, 2)
  },
  
  ai_confidence_score: {
    type: DataTypes.FLOAT,
    comment: 'AI detection confidence score (0-1)'
  },
  
  ai_analysis: {
    type: DataTypes.JSONB,
    comment: 'AI analysis results and patterns detected'
  },
  
  risk_score: {
    type: DataTypes.INTEGER,
    comment: 'Overall risk score (1-100)'
  },
  
  compliance_impact: {
    type: DataTypes.JSONB,
    defaultValue: {
      cms_violation: false,
      hipaa_violation: false,
      false_claims_act: false,
      anti_kickback: false
    }
  },
  
  timeline: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Complete timeline of incident lifecycle'
  },
  
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'fwa_incidents',
  timestamps: true,
  paranoid: true,
  indexes: [
    { fields: ['incident_number'], unique: true },
    { fields: ['incident_type'] },
    { fields: ['status'] },
    { fields: ['severity'] },
    { fields: ['reported_date'] },
    { fields: ['incident_date'] },
    { fields: ['detection_method'] },
    { fields: ['regulatory_reported'] },
    { fields: ['oig_referral'] }
  ],
  hooks: {
    beforeCreate: (incident) => {
      // Generate incident number
      const prefix = incident.incident_type.substring(0, 3).toUpperCase();
      const timestamp = Date.now().toString(36).toUpperCase();
      incident.incident_number = `${prefix}-${timestamp}`;
      
      // Initialize timeline
      incident.timeline = [{
        action: 'REPORTED',
        timestamp: new Date(),
        user: incident.reporter_id || 'SYSTEM',
        details: {
          type: incident.incident_type,
          method: incident.detection_method
        }
      }];
      
      // Calculate initial risk score
      incident.risk_score = calculateRiskScore(incident);
    },
    
    beforeUpdate: (incident) => {
      const changes = incident.changed();
      if (changes && changes.length > 0) {
        const timelineEntry = {
          action: 'UPDATED',
          timestamp: new Date(),
          changes: changes
        };
        
        if (changes.includes('status')) {
          timelineEntry.action = `STATUS_CHANGED_TO_${incident.status}`;
          
          // Track investigation dates
          if (incident.status === 'UNDER_INVESTIGATION' && !incident.investigation_started) {
            incident.investigation_started = new Date();
          }
          if (['RESOLVED', 'CLOSED', 'UNSUBSTANTIATED'].includes(incident.status) && !incident.investigation_completed) {
            incident.investigation_completed = new Date();
          }
        }
        
        incident.timeline = [...(incident.timeline || []), timelineEntry];
        incident.risk_score = calculateRiskScore(incident);
      }
    }
  }
});

// Calculate risk score based on incident attributes
function calculateRiskScore(incident) {
  let score = 0;
  
  // Severity scoring
  const severityScores = { LOW: 10, MEDIUM: 25, HIGH: 50, CRITICAL: 75 };
  score += severityScores[incident.severity] || 0;
  
  // Type scoring
  const typeScores = {
    FRAUD: 25,
    IDENTITY_THEFT: 20,
    UNAUTHORIZED_DISCLOSURE: 20,
    BILLING_IRREGULARITY: 15,
    ENROLLMENT_MANIPULATION: 15,
    ABUSE: 10,
    WASTE: 5
  };
  score += typeScores[incident.incident_type] || 10;
  
  // Financial impact
  if (incident.financial_impact > 100000) score += 25;
  else if (incident.financial_impact > 10000) score += 15;
  else if (incident.financial_impact > 1000) score += 5;
  
  // Affected beneficiaries
  if (incident.affected_count > 100) score += 20;
  else if (incident.affected_count > 10) score += 10;
  else if (incident.affected_count > 1) score += 5;
  
  // Compliance violations
  const violations = incident.compliance_impact || {};
  if (violations.false_claims_act) score += 30;
  if (violations.anti_kickback) score += 25;
  if (violations.cms_violation) score += 20;
  if (violations.hipaa_violation) score += 15;
  
  return Math.min(100, score);
}

// Instance methods
FWAIncident.prototype.escalate = async function(reason, userId) {
  this.severity = this.severity === 'LOW' ? 'MEDIUM' : 
                  this.severity === 'MEDIUM' ? 'HIGH' : 'CRITICAL';
  
  const timelineEntry = {
    action: 'ESCALATED',
    timestamp: new Date(),
    user: userId,
    reason: reason,
    new_severity: this.severity
  };
  
  this.timeline = [...(this.timeline || []), timelineEntry];
  
  return await this.save();
};

FWAIncident.prototype.referToOIG = async function(caseNumber, userId) {
  this.oig_referral = true;
  this.oig_case_number = caseNumber;
  this.regulatory_reported = true;
  this.regulatory_report_date = new Date();
  this.status = 'REFERRED_TO_OIG';
  
  const timelineEntry = {
    action: 'REFERRED_TO_OIG',
    timestamp: new Date(),
    user: userId,
    case_number: caseNumber
  };
  
  this.timeline = [...(this.timeline || []), timelineEntry];
  
  return await this.save();
};

// Class methods
FWAIncident.getActiveIncidents = function() {
  return this.findAll({
    where: {
      status: {
        [sequelize.Sequelize.Op.notIn]: ['RESOLVED', 'CLOSED', 'UNSUBSTANTIATED']
      }
    },
    order: [['severity', 'DESC'], ['reported_date', 'DESC']]
  });
};

FWAIncident.getHighRiskIncidents = function() {
  return this.findAll({
    where: {
      [sequelize.Sequelize.Op.or]: [
        { severity: { [sequelize.Sequelize.Op.in]: ['HIGH', 'CRITICAL'] } },
        { risk_score: { [sequelize.Sequelize.Op.gte]: 70 } },
        { false_claims_act_violation: true }
      ]
    },
    order: [['risk_score', 'DESC']]
  });
};

module.exports = FWAIncident;