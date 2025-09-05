const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const crypto = require('crypto');

const Document = sequelize.define('Document', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  
  document_id: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: 'Unique document identifier for retrieval'
  },
  
  document_type: {
    type: DataTypes.ENUM(
      'CONSENT_FORM',
      'ENROLLMENT_RECORD',
      'TRAINING_CERTIFICATE',
      'SCREENING_REPORT',
      'AUDIT_REPORT',
      'INVESTIGATION_FILE',
      'CALL_RECORDING',
      'POLICY_DOCUMENT',
      'COMPLIANCE_RECORD',
      'BENEFICIARY_COMMUNICATION',
      'CORRECTIVE_ACTION_PLAN',
      'CONTRACT',
      'CLINICAL_RECORD'
    ),
    allowNull: false
  },
  
  category: {
    type: DataTypes.ENUM(
      'MEMBER_ENROLLMENT',
      'CLINICAL',
      'COMPLIANCE',
      'TRAINING',
      'INVESTIGATION',
      'AUDIT',
      'OPERATIONAL',
      'LEGAL'
    ),
    allowNull: false
  },
  
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  
  description: {
    type: DataTypes.TEXT
  },
  
  file_name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  
  file_size: {
    type: DataTypes.BIGINT,
    comment: 'File size in bytes'
  },
  
  mime_type: {
    type: DataTypes.STRING
  },
  
  storage_location: {
    type: DataTypes.ENUM('S3', 'BOX', 'LOCAL', 'DIGITALOCEAN_SPACES'),
    defaultValue: 'DIGITALOCEAN_SPACES',
    allowNull: false
  },
  
  storage_path: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Full path or URL to document in storage'
  },
  
  storage_bucket: {
    type: DataTypes.STRING,
    comment: 'S3 bucket or DigitalOcean Space name'
  },
  
  encryption_status: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  
  encryption_algorithm: {
    type: DataTypes.STRING,
    defaultValue: 'AES-256-GCM'
  },
  
  checksum: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'SHA-256 hash for integrity verification'
  },
  
  retention_date: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'Date until which document must be retained'
  },
  
  retention_years: {
    type: DataTypes.INTEGER,
    defaultValue: 10,
    allowNull: false,
    comment: 'CMS requires 10-year retention'
  },
  
  disposal_date: {
    type: DataTypes.DATE,
    comment: 'Scheduled disposal date after retention period'
  },
  
  legal_hold: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Document under legal hold, cannot be deleted'
  },
  
  legal_hold_reason: {
    type: DataTypes.TEXT
  },
  
  related_entity_type: {
    type: DataTypes.STRING,
    comment: 'Type of related entity (e.g., Consent, Employee)'
  },
  
  related_entity_id: {
    type: DataTypes.STRING,
    comment: 'ID of related entity'
  },
  
  beneficiary_id: {
    type: DataTypes.STRING,
    comment: 'Associated beneficiary if applicable'
  },
  
  employee_id: {
    type: DataTypes.STRING,
    comment: 'Associated employee if applicable'
  },
  
  created_by: {
    type: DataTypes.STRING,
    allowNull: false
  },
  
  last_accessed: {
    type: DataTypes.DATE
  },
  
  access_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  tags: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: [],
    comment: 'Tags for search and categorization'
  },
  
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Additional document metadata'
  },
  
  ocr_text: {
    type: DataTypes.TEXT,
    comment: 'OCR extracted text for searchability'
  },
  
  search_vector: {
    type: DataTypes.TSVECTOR,
    comment: 'Full-text search vector'
  },
  
  compliance_metadata: {
    type: DataTypes.JSONB,
    defaultValue: {
      hipaa_compliant: true,
      cms_compliant: true,
      audit_ready: true
    }
  },
  
  audit_trail: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Complete audit trail of document lifecycle'
  },
  
  version: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  
  previous_version_id: {
    type: DataTypes.UUID,
    comment: 'Reference to previous version if this is an update'
  },
  
  is_current: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether this is the current version'
  }
}, {
  tableName: 'documents',
  timestamps: true,
  paranoid: true,
  indexes: [
    { fields: ['document_id'], unique: true },
    { fields: ['document_type'] },
    { fields: ['category'] },
    { fields: ['beneficiary_id'] },
    { fields: ['employee_id'] },
    { fields: ['retention_date'] },
    { fields: ['legal_hold'] },
    { fields: ['created_at'] },
    { fields: ['tags'], using: 'gin' },
    { 
      fields: ['search_vector'], 
      using: 'gin',
      name: 'documents_search_idx'
    },
    {
      fields: ['document_type', 'category', 'created_at'],
      name: 'documents_type_category_date_idx'
    }
  ],
  hooks: {
    beforeCreate: async (document) => {
      // Generate document ID
      const prefix = document.document_type.substring(0, 3).toUpperCase();
      const timestamp = Date.now().toString(36).toUpperCase();
      document.document_id = `DOC-${prefix}-${timestamp}`;
      
      // Calculate retention date
      const retentionYears = document.retention_years || 10;
      const retentionDate = new Date();
      retentionDate.setFullYear(retentionDate.getFullYear() + retentionYears);
      document.retention_date = retentionDate;
      
      // Set disposal date (30 days after retention date)
      const disposalDate = new Date(retentionDate);
      disposalDate.setDate(disposalDate.getDate() + 30);
      document.disposal_date = disposalDate;
      
      // Initialize audit trail
      document.audit_trail = [{
        action: 'CREATED',
        timestamp: new Date(),
        user: document.created_by,
        details: {
          type: document.document_type,
          category: document.category,
          retention_years: retentionYears
        }
      }];
      
      // Generate checksum placeholder (would be calculated from actual file)
      if (!document.checksum) {
        const data = `${document.file_name}|${document.file_size}|${Date.now()}`;
        document.checksum = crypto.createHash('sha256').update(data).digest('hex');
      }
    },
    
    beforeUpdate: (document) => {
      const changes = document.changed();
      if (changes && changes.length > 0) {
        const auditEntry = {
          action: 'UPDATED',
          timestamp: new Date(),
          changes: changes
        };
        
        if (changes.includes('legal_hold')) {
          auditEntry.action = document.legal_hold ? 'LEGAL_HOLD_APPLIED' : 'LEGAL_HOLD_REMOVED';
          auditEntry.reason = document.legal_hold_reason;
        }
        
        document.audit_trail = [...(document.audit_trail || []), auditEntry];
      }
    },
    
    afterFind: (documents) => {
      // Update last accessed timestamp
      if (documents) {
        const docs = Array.isArray(documents) ? documents : [documents];
        docs.forEach(doc => {
          if (doc) {
            doc.last_accessed = new Date();
            doc.access_count = (doc.access_count || 0) + 1;
            doc.save({ hooks: false }).catch(err => console.error('Error updating access info:', err));
          }
        });
      }
    }
  }
});

// Instance methods
Document.prototype.applyLegalHold = async function(reason, userId) {
  this.legal_hold = true;
  this.legal_hold_reason = reason;
  
  const auditEntry = {
    action: 'LEGAL_HOLD_APPLIED',
    timestamp: new Date(),
    user: userId,
    reason: reason
  };
  
  this.audit_trail = [...(this.audit_trail || []), auditEntry];
  
  return await this.save();
};

Document.prototype.isRetentionExpired = function() {
  return !this.legal_hold && new Date() > new Date(this.retention_date);
};

Document.prototype.canBeDeleted = function() {
  return this.isRetentionExpired() && !this.legal_hold;
};

Document.prototype.createNewVersion = async function(updates, userId) {
  const newVersion = await Document.create({
    ...this.toJSON(),
    ...updates,
    id: undefined,
    document_id: undefined,
    version: this.version + 1,
    previous_version_id: this.id,
    created_by: userId,
    audit_trail: [{
      action: 'VERSION_CREATED',
      timestamp: new Date(),
      user: userId,
      previous_version: this.version
    }]
  });
  
  // Mark current version as not current
  this.is_current = false;
  await this.save();
  
  return newVersion;
};

// Class methods
Document.searchDocuments = async function(query, options = {}) {
  const {
    type,
    category,
    startDate,
    endDate,
    tags,
    beneficiaryId,
    employeeId,
    limit = 100,
    offset = 0
  } = options;
  
  const where = {};
  
  if (type) where.document_type = type;
  if (category) where.category = category;
  if (beneficiaryId) where.beneficiary_id = beneficiaryId;
  if (employeeId) where.employee_id = employeeId;
  
  if (startDate || endDate) {
    where.created_at = {};
    if (startDate) where.created_at[sequelize.Sequelize.Op.gte] = startDate;
    if (endDate) where.created_at[sequelize.Sequelize.Op.lte] = endDate;
  }
  
  if (tags && tags.length > 0) {
    where.tags = {
      [sequelize.Sequelize.Op.overlap]: tags
    };
  }
  
  // Full-text search if query provided
  if (query) {
    where[sequelize.Sequelize.Op.or] = [
      { title: { [sequelize.Sequelize.Op.iLike]: `%${query}%` } },
      { description: { [sequelize.Sequelize.Op.iLike]: `%${query}%` } },
      { ocr_text: { [sequelize.Sequelize.Op.iLike]: `%${query}%` } }
    ];
  }
  
  return await this.findAndCountAll({
    where,
    limit,
    offset,
    order: [['created_at', 'DESC']]
  });
};

Document.getExpiringDocuments = function(days = 30) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  
  return this.findAll({
    where: {
      retention_date: {
        [sequelize.Sequelize.Op.between]: [new Date(), futureDate]
      },
      legal_hold: false
    },
    order: [['retention_date', 'ASC']]
  });
};

Document.getDocumentsForDisposal = function() {
  return this.findAll({
    where: {
      disposal_date: {
        [sequelize.Sequelize.Op.lte]: new Date()
      },
      legal_hold: false
    }
  });
};

module.exports = Document;