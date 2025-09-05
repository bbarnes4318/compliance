const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const crypto = require('crypto');

const Consent = sequelize.define('Consent', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  
  beneficiary_id: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Medicare beneficiary ID'
  },
  
  beneficiary_name: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Full name of beneficiary'
  },
  
  beneficiary_phone: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      is: /^\+?[1-9]\d{1,14}$/
    }
  },
  
  beneficiary_email: {
    type: DataTypes.STRING,
    validate: {
      isEmail: true
    }
  },
  
  consent_type: {
    type: DataTypes.ENUM('WRITTEN', 'VERBAL', 'ELECTRONIC'),
    allowNull: false,
    comment: 'CMS 2025 requires explicit consent type tracking'
  },
  
  consent_scope: {
    type: DataTypes.ENUM('ONE_TO_ONE', 'LIMITED_SHARING', 'BROAD_SHARING'),
    defaultValue: 'ONE_TO_ONE',
    allowNull: false,
    comment: 'CMS Contract Year 2025 mandates one-to-one consent'
  },
  
  tpmo_organization: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Third-Party Marketing Organization name'
  },
  
  tpmo_agent_id: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'TPMO agent who obtained consent'
  },
  
  transfer_to_organization: {
    type: DataTypes.STRING,
    comment: 'Organization receiving the warm transfer'
  },
  
  transfer_to_agent_id: {
    type: DataTypes.STRING,
    comment: 'Agent receiving the warm transfer'
  },
  
  consent_datetime: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  
  expiration_date: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'Consent expiration per CMS guidelines'
  },
  
  revoked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  
  revocation_date: {
    type: DataTypes.DATE
  },
  
  revocation_reason: {
    type: DataTypes.TEXT
  },
  
  call_recording_id: {
    type: DataTypes.STRING,
    comment: 'Reference to call recording for verbal consent'
  },
  
  document_id: {
    type: DataTypes.STRING,
    comment: 'Reference to written consent document'
  },
  
  ip_address: {
    type: DataTypes.STRING,
    comment: 'IP address for electronic consent'
  },
  
  user_agent: {
    type: DataTypes.TEXT,
    comment: 'Browser info for electronic consent'
  },
  
  consent_text: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Exact consent language presented to beneficiary'
  },
  
  consent_hash: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'SHA-256 hash of consent for integrity verification'
  },
  
  verification_method: {
    type: DataTypes.STRING,
    comment: 'How beneficiary identity was verified'
  },
  
  language: {
    type: DataTypes.STRING,
    defaultValue: 'en',
    comment: 'Language in which consent was obtained'
  },
  
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Additional consent metadata'
  },
  
  audit_trail: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Complete audit trail of consent lifecycle'
  },
  
  compliance_flags: {
    type: DataTypes.JSONB,
    defaultValue: {
      cms_compliant: true,
      hipaa_compliant: true,
      tcpa_compliant: true
    }
  }
}, {
  tableName: 'consents',
  timestamps: true,
  paranoid: true,
  indexes: [
    { fields: ['beneficiary_id'] },
    { fields: ['beneficiary_phone'] },
    { fields: ['tpmo_agent_id'] },
    { fields: ['consent_datetime'] },
    { fields: ['expiration_date'] },
    { fields: ['revoked'] },
    { fields: ['consent_type', 'consent_scope'] }
  ],
  hooks: {
    beforeCreate: (consent) => {
      // Generate consent hash for integrity
      const consentData = `${consent.beneficiary_id}|${consent.consent_text}|${consent.consent_datetime}`;
      consent.consent_hash = crypto.createHash('sha256').update(consentData).digest('hex');
      
      // Set expiration date if not provided (90 days for verbal, 1 year for written)
      if (!consent.expiration_date) {
        const expirationDays = consent.consent_type === 'VERBAL' ? 90 : 365;
        consent.expiration_date = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000);
      }
      
      // Add creation to audit trail
      consent.audit_trail = [{
        action: 'CREATED',
        timestamp: new Date(),
        user: consent.tpmo_agent_id,
        details: {
          type: consent.consent_type,
          scope: consent.consent_scope
        }
      }];
    },
    
    beforeUpdate: (consent) => {
      // Update audit trail
      const changes = consent.changed();
      if (changes && changes.length > 0) {
        const auditEntry = {
          action: 'UPDATED',
          timestamp: new Date(),
          changes: changes,
          user: consent.tpmo_agent_id
        };
        
        if (consent.revoked && changes.includes('revoked')) {
          auditEntry.action = 'REVOKED';
          auditEntry.reason = consent.revocation_reason;
        }
        
        consent.audit_trail = [...(consent.audit_trail || []), auditEntry];
      }
    }
  }
});

// Instance methods
Consent.prototype.isValid = function() {
  return !this.revoked && new Date() < new Date(this.expiration_date);
};

Consent.prototype.canTransferTo = function(organizationId) {
  if (this.consent_scope === 'ONE_TO_ONE') {
    return this.transfer_to_organization === organizationId;
  }
  return this.isValid();
};

Consent.prototype.revoke = async function(reason, userId) {
  this.revoked = true;
  this.revocation_date = new Date();
  this.revocation_reason = reason;
  
  const auditEntry = {
    action: 'REVOKED',
    timestamp: new Date(),
    user: userId,
    reason: reason
  };
  
  this.audit_trail = [...(this.audit_trail || []), auditEntry];
  
  return await this.save();
};

// Class methods
Consent.findActiveConsents = function(beneficiaryId) {
  return this.findAll({
    where: {
      beneficiary_id: beneficiaryId,
      revoked: false,
      expiration_date: {
        [sequelize.Sequelize.Op.gt]: new Date()
      }
    },
    order: [['consent_datetime', 'DESC']]
  });
};

Consent.checkConsentExists = async function(beneficiaryPhone, organizationId) {
  const consent = await this.findOne({
    where: {
      beneficiary_phone: beneficiaryPhone,
      transfer_to_organization: organizationId,
      revoked: false,
      expiration_date: {
        [sequelize.Sequelize.Op.gt]: new Date()
      }
    },
    order: [['consent_datetime', 'DESC']]
  });
  
  return consent ? consent.isValid() : false;
};

module.exports = Consent;