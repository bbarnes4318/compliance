const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const bcrypt = require('bcrypt');

const Employee = sequelize.define('Employee', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  
  employee_id: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: 'Company employee ID'
  },
  
  first_name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  
  last_name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  
  email: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    validate: {
      isEmail: true
    }
  },
  
  password_hash: {
    type: DataTypes.STRING,
    comment: 'Hashed password for system access'
  },
  
  phone: {
    type: DataTypes.STRING
  },
  
  department: {
    type: DataTypes.STRING,
    allowNull: false
  },
  
  position: {
    type: DataTypes.STRING,
    allowNull: false
  },
  
  role: {
    type: DataTypes.ENUM(
      'AGENT',
      'SUPERVISOR',
      'COMPLIANCE_OFFICER',
      'TRAINING_COORDINATOR',
      'QUALITY_ANALYST',
      'MANAGER',
      'ADMIN',
      'AUDITOR'
    ),
    allowNull: false
  },
  
  clearance_level: {
    type: DataTypes.ENUM('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'),
    defaultValue: 'INTERNAL'
  },
  
  hire_date: {
    type: DataTypes.DATE,
    allowNull: false
  },
  
  termination_date: {
    type: DataTypes.DATE
  },
  
  status: {
    type: DataTypes.ENUM('ACTIVE', 'INACTIVE', 'TERMINATED', 'SUSPENDED'),
    defaultValue: 'ACTIVE',
    allowNull: false
  },
  
  supervisor_id: {
    type: DataTypes.UUID,
    comment: 'References another employee who is the supervisor'
  },
  
  ssn_last_four: {
    type: DataTypes.STRING(4),
    comment: 'Last 4 digits of SSN for identification'
  },
  
  date_of_birth: {
    type: DataTypes.DATE
  },
  
  background_check_status: {
    type: DataTypes.ENUM('PENDING', 'APPROVED', 'DENIED', 'EXPIRED'),
    allowNull: false,
    defaultValue: 'PENDING'
  },
  
  background_check_date: {
    type: DataTypes.DATE
  },
  
  background_check_expiry: {
    type: DataTypes.DATE
  },
  
  fingerprint_status: {
    type: DataTypes.ENUM('PENDING', 'APPROVED', 'DENIED', 'NOT_REQUIRED'),
    defaultValue: 'NOT_REQUIRED'
  },
  
  excluded_status: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
    comment: 'Whether employee is on OIG/GSA exclusion list'
  },
  
  exclusion_details: {
    type: DataTypes.JSONB,
    comment: 'Details if employee is excluded'
  },
  
  last_screening_date: {
    type: DataTypes.DATE,
    comment: 'Last OIG/GSA screening date'
  },
  
  next_screening_date: {
    type: DataTypes.DATE,
    comment: 'Next required screening date (monthly)'
  },
  
  screening_frequency: {
    type: DataTypes.INTEGER,
    defaultValue: 30,
    comment: 'Screening frequency in days'
  },
  
  training_status: {
    type: DataTypes.ENUM('INCOMPLETE', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED'),
    defaultValue: 'INCOMPLETE'
  },
  
  fwa_training_date: {
    type: DataTypes.DATE,
    comment: 'Last FWA training completion date'
  },
  
  fwa_training_expiry: {
    type: DataTypes.DATE,
    comment: 'FWA training expiration date (annual)'
  },
  
  initial_training_completed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'CMS requires training within 90 days of hire'
  },
  
  certifications: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Professional certifications held'
  },
  
  licenses: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Professional licenses held'
  },
  
  permissions: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'System permissions and access levels'
  },
  
  two_factor_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  
  two_factor_secret: {
    type: DataTypes.STRING,
    comment: 'TOTP secret for 2FA'
  },
  
  last_login: {
    type: DataTypes.DATE
  },
  
  failed_login_attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  account_locked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  
  lock_expires: {
    type: DataTypes.DATE
  },
  
  conflict_of_interest_disclosed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Annual COI disclosure required'
  },
  
  coi_disclosure_date: {
    type: DataTypes.DATE
  },
  
  coi_next_due: {
    type: DataTypes.DATE
  },
  
  performance_metrics: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Performance and compliance metrics'
  },
  
  disciplinary_actions: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'History of disciplinary actions'
  },
  
  emergency_contact: {
    type: DataTypes.JSONB,
    comment: 'Emergency contact information'
  },
  
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  
  audit_trail: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Complete audit trail of employee record changes'
  }
}, {
  tableName: 'employees',
  timestamps: true,
  paranoid: true,
  indexes: [
    { fields: ['employee_id'], unique: true },
    { fields: ['email'], unique: true },
    { fields: ['status'] },
    { fields: ['role'] },
    { fields: ['department'] },
    { fields: ['excluded_status'] },
    { fields: ['training_status'] },
    { fields: ['next_screening_date'] },
    { fields: ['fwa_training_expiry'] },
    { fields: ['hire_date'] },
    { fields: ['supervisor_id'] }
  ],
  hooks: {
    beforeCreate: async (employee) => {
      // Generate employee ID if not provided
      if (!employee.employee_id) {
        const prefix = employee.department.substring(0, 3).toUpperCase();
        const timestamp = Date.now().toString(36).toUpperCase();
        employee.employee_id = `EMP-${prefix}-${timestamp}`;
      }
      
      // Hash password if provided
      if (employee.password_hash && !employee.password_hash.startsWith('$2b$')) {
        employee.password_hash = await bcrypt.hash(employee.password_hash, 12);
      }
      
      // Set screening dates
      if (!employee.next_screening_date) {
        const nextScreening = new Date();
        nextScreening.setDate(nextScreening.getDate() + (employee.screening_frequency || 30));
        employee.next_screening_date = nextScreening;
      }
      
      // Set FWA training deadline (90 days from hire)
      if (!employee.fwa_training_expiry) {
        const trainingDeadline = new Date(employee.hire_date);
        trainingDeadline.setDate(trainingDeadline.getDate() + 90);
        employee.fwa_training_expiry = trainingDeadline;
      }
      
      // Set annual COI disclosure due date
      if (!employee.coi_next_due) {
        const coiDue = new Date();
        coiDue.setFullYear(coiDue.getFullYear() + 1);
        employee.coi_next_due = coiDue;
      }
      
      // Initialize audit trail
      employee.audit_trail = [{
        action: 'CREATED',
        timestamp: new Date(),
        user: 'SYSTEM',
        details: {
          role: employee.role,
          department: employee.department,
          hire_date: employee.hire_date
        }
      }];
    },
    
    beforeUpdate: async (employee) => {
      // Hash password if changed
      if (employee.changed('password_hash') && employee.password_hash && !employee.password_hash.startsWith('$2b$')) {
        employee.password_hash = await bcrypt.hash(employee.password_hash, 12);
      }
      
      // Update audit trail
      const changes = employee.changed();
      if (changes && changes.length > 0) {
        const auditEntry = {
          action: 'UPDATED',
          timestamp: new Date(),
          changes: changes
        };
        
        if (changes.includes('excluded_status') && employee.excluded_status) {
          auditEntry.action = 'EXCLUSION_DETECTED';
          auditEntry.details = employee.exclusion_details;
        }
        
        if (changes.includes('status') && employee.status === 'TERMINATED') {
          auditEntry.action = 'TERMINATED';
          auditEntry.termination_date = employee.termination_date;
        }
        
        employee.audit_trail = [...(employee.audit_trail || []), auditEntry];
      }
    }
  }
});

// Define associations
Employee.belongsTo(Employee, { as: 'Supervisor', foreignKey: 'supervisor_id' });
Employee.hasMany(Employee, { as: 'Subordinates', foreignKey: 'supervisor_id' });

// Instance methods
Employee.prototype.validatePassword = async function(password) {
  if (!this.password_hash) return false;
  return await bcrypt.compare(password, this.password_hash);
};

Employee.prototype.updateLastLogin = async function() {
  this.last_login = new Date();
  this.failed_login_attempts = 0;
  this.account_locked = false;
  return await this.save({ hooks: false });
};

Employee.prototype.incrementFailedLogins = async function() {
  this.failed_login_attempts += 1;
  
  if (this.failed_login_attempts >= 5) {
    this.account_locked = true;
    const lockExpiry = new Date();
    lockExpiry.setHours(lockExpiry.getHours() + 1);
    this.lock_expires = lockExpiry;
  }
  
  return await this.save({ hooks: false });
};

Employee.prototype.isAccountLocked = function() {
  if (!this.account_locked) return false;
  if (this.lock_expires && new Date() > this.lock_expires) {
    this.account_locked = false;
    this.failed_login_attempts = 0;
    this.save({ hooks: false });
    return false;
  }
  return true;
};

Employee.prototype.needsScreening = function() {
  return !this.next_screening_date || new Date() >= new Date(this.next_screening_date);
};

Employee.prototype.needsFWATraining = function() {
  return !this.fwa_training_expiry || new Date() >= new Date(this.fwa_training_expiry);
};

Employee.prototype.isTrainingCompliant = function() {
  return this.initial_training_completed && !this.needsFWATraining();
};

Employee.prototype.addDisciplinaryAction = async function(action, reason, severity, userId) {
  const disciplinaryAction = {
    date: new Date(),
    action,
    reason,
    severity,
    imposed_by: userId,
    id: require('uuid').v4()
  };
  
  this.disciplinary_actions = [...(this.disciplinary_actions || []), disciplinaryAction];
  
  const auditEntry = {
    action: 'DISCIPLINARY_ACTION',
    timestamp: new Date(),
    user: userId,
    details: disciplinaryAction
  };
  
  this.audit_trail = [...(this.audit_trail || []), auditEntry];
  
  return await this.save();
};

// Class methods
Employee.getEmployeesNeedingScreening = function() {
  return this.findAll({
    where: {
      status: 'ACTIVE',
      next_screening_date: {
        [sequelize.Sequelize.Op.lte]: new Date()
      }
    },
    order: [['next_screening_date', 'ASC']]
  });
};

Employee.getEmployeesNeedingTraining = function() {
  return this.findAll({
    where: {
      status: 'ACTIVE',
      [sequelize.Sequelize.Op.or]: [
        { initial_training_completed: false },
        {
          fwa_training_expiry: {
            [sequelize.Sequelize.Op.lte]: new Date()
          }
        }
      ]
    }
  });
};

Employee.getExcludedEmployees = function() {
  return this.findAll({
    where: {
      excluded_status: true
    },
    include: [{
      model: Employee,
      as: 'Supervisor',
      attributes: ['first_name', 'last_name', 'email']
    }]
  });
};

module.exports = Employee;