const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { Consent } = require('../models/Consent');
const { logger } = require('../utils/logger');
const { cacheHelpers } = require('../config/redis');

const router = express.Router();

// Validation middleware
const validateConsent = [
  body('beneficiary_id').notEmpty().withMessage('Beneficiary ID is required'),
  body('beneficiary_name').notEmpty().withMessage('Beneficiary name is required'),
  body('beneficiary_phone').isMobilePhone().withMessage('Valid phone number is required'),
  body('consent_type').isIn(['WRITTEN', 'VERBAL', 'ELECTRONIC']).withMessage('Invalid consent type'),
  body('consent_scope').isIn(['ONE_TO_ONE', 'LIMITED_SHARING', 'BROAD_SHARING']).withMessage('Invalid consent scope'),
  body('tpmo_organization').notEmpty().withMessage('TPMO organization is required'),
  body('tpmo_agent_id').notEmpty().withMessage('TPMO agent ID is required'),
  body('consent_text').notEmpty().withMessage('Consent text is required')
];

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Create new consent record
router.post('/', validateConsent, handleValidation, async (req, res) => {
  try {
    logger.info(`📝 Creating consent record for beneficiary: ${req.body.beneficiary_id}`);
    
    // Check for existing active consent
    const existingConsent = await Consent.checkConsentExists(
      req.body.beneficiary_phone,
      req.body.transfer_to_organization
    );
    
    if (existingConsent && req.body.consent_scope === 'ONE_TO_ONE') {
      return res.status(409).json({
        error: 'Active consent already exists',
        message: 'CMS Contract Year 2025 requires one-to-one consent. Existing active consent found.'
      });
    }
    
    const consent = await Consent.create({
      ...req.body,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });
    
    // Invalidate related caches
    await cacheHelpers.invalidatePattern(`consent:${req.body.beneficiary_id}*`);
    
    logger.info(`✅ Consent created: ${consent.id}`);
    
    res.status(201).json({
      success: true,
      consent: {
        id: consent.id,
        consent_datetime: consent.consent_datetime,
        expiration_date: consent.expiration_date,
        consent_hash: consent.consent_hash,
        compliance_status: 'CMS_2025_COMPLIANT'
      }
    });
    
  } catch (error) {
    logger.error('❌ Error creating consent:', error);
    res.status(500).json({ 
      error: 'Failed to create consent record',
      message: error.message 
    });
  }
});

// Get consent by ID
router.get('/:id', param('id').isUUID().withMessage('Invalid consent ID'), async (req, res) => {
  try {
    const consent = await Consent.findByPk(req.params.id);
    
    if (!consent) {
      return res.status(404).json({ error: 'Consent not found' });
    }
    
    res.json({
      success: true,
      consent
    });
    
  } catch (error) {
    logger.error('❌ Error fetching consent:', error);
    res.status(500).json({ error: 'Failed to fetch consent' });
  }
});

// Search consents
router.get('/', [
  query('beneficiary_id').optional(),
  query('beneficiary_phone').optional(),
  query('tpmo_organization').optional(),
  query('status').optional().isIn(['active', 'expired', 'revoked']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], async (req, res) => {
  try {
    const { 
      beneficiary_id, 
      beneficiary_phone, 
      tpmo_organization, 
      status,
      page = 1, 
      limit = 20 
    } = req.query;
    
    const where = {};
    
    if (beneficiary_id) where.beneficiary_id = beneficiary_id;
    if (beneficiary_phone) where.beneficiary_phone = beneficiary_phone;
    if (tpmo_organization) where.tpmo_organization = tpmo_organization;
    
    if (status === 'active') {
      where.revoked = false;
      where.expiration_date = {
        [Consent.sequelize.Op.gt]: new Date()
      };
    } else if (status === 'expired') {
      where.revoked = false;
      where.expiration_date = {
        [Consent.sequelize.Op.lte]: new Date()
      };
    } else if (status === 'revoked') {
      where.revoked = true;
    }
    
    const offset = (page - 1) * limit;
    
    const { count, rows } = await Consent.findAndCountAll({
      where,
      limit,
      offset,
      order: [['consent_datetime', 'DESC']]
    });
    
    const cacheKey = `consent_search:${Buffer.from(JSON.stringify(req.query)).toString('base64')}`;
    await cacheHelpers.setWithExpiry(cacheKey, { count, rows }, 300);
    
    res.json({
      success: true,
      consents: rows,
      pagination: {
        total: count,
        page,
        limit,
        pages: Math.ceil(count / limit)
      }
    });
    
  } catch (error) {
    logger.error('❌ Error searching consents:', error);
    res.status(500).json({ error: 'Failed to search consents' });
  }
});

// Verify consent for transfer
router.post('/verify', [
  body('beneficiary_phone').isMobilePhone().withMessage('Valid phone number is required'),
  body('transfer_to_organization').notEmpty().withMessage('Transfer organization is required')
], handleValidation, async (req, res) => {
  try {
    const { beneficiary_phone, transfer_to_organization } = req.body;
    
    const consent = await Consent.findOne({
      where: {
        beneficiary_phone,
        transfer_to_organization,
        revoked: false,
        expiration_date: {
          [Consent.sequelize.Op.gt]: new Date()
        }
      },
      order: [['consent_datetime', 'DESC']]
    });
    
    const isValid = consent && consent.isValid();
    const canTransfer = consent && consent.canTransferTo(transfer_to_organization);
    
    res.json({
      success: true,
      consent_valid: isValid,
      transfer_authorized: canTransfer,
      consent_type: consent?.consent_type,
      consent_scope: consent?.consent_scope,
      consent_date: consent?.consent_datetime,
      expiration_date: consent?.expiration_date,
      cms_2025_compliant: consent?.consent_scope === 'ONE_TO_ONE'
    });
    
  } catch (error) {
    logger.error('❌ Error verifying consent:', error);
    res.status(500).json({ error: 'Failed to verify consent' });
  }
});

// Revoke consent
router.patch('/:id/revoke', [
  param('id').isUUID().withMessage('Invalid consent ID'),
  body('reason').notEmpty().withMessage('Revocation reason is required')
], handleValidation, async (req, res) => {
  try {
    const consent = await Consent.findByPk(req.params.id);
    
    if (!consent) {
      return res.status(404).json({ error: 'Consent not found' });
    }
    
    if (consent.revoked) {
      return res.status(400).json({ error: 'Consent already revoked' });
    }
    
    await consent.revoke(req.body.reason, req.user?.id);
    
    // Invalidate caches
    await cacheHelpers.invalidatePattern(`consent:${consent.beneficiary_id}*`);
    
    logger.info(`🔄 Consent revoked: ${consent.id}`);
    
    res.json({
      success: true,
      message: 'Consent revoked successfully',
      revocation_date: consent.revocation_date
    });
    
  } catch (error) {
    logger.error('❌ Error revoking consent:', error);
    res.status(500).json({ error: 'Failed to revoke consent' });
  }
});

// Get consent compliance report
router.get('/reports/compliance', [
  query('start_date').optional().isISO8601().toDate(),
  query('end_date').optional().isISO8601().toDate(),
  query('organization').optional()
], async (req, res) => {
  try {
    const { start_date, end_date, organization } = req.query;
    
    const where = {};
    if (start_date || end_date) {
      where.consent_datetime = {};
      if (start_date) where.consent_datetime[Consent.sequelize.Op.gte] = start_date;
      if (end_date) where.consent_datetime[Consent.sequelize.Op.lte] = end_date;
    }
    if (organization) where.tpmo_organization = organization;
    
    const [
      totalConsents,
      consentsByType,
      consentsByScope,
      activeConsents,
      revokedConsents,
      expiredConsents
    ] = await Promise.all([
      Consent.count({ where }),
      Consent.findAll({
        where,
        attributes: [
          'consent_type',
          [Consent.sequelize.fn('COUNT', '*'), 'count']
        ],
        group: 'consent_type'
      }),
      Consent.findAll({
        where,
        attributes: [
          'consent_scope',
          [Consent.sequelize.fn('COUNT', '*'), 'count']
        ],
        group: 'consent_scope'
      }),
      Consent.count({
        where: {
          ...where,
          revoked: false,
          expiration_date: { [Consent.sequelize.Op.gt]: new Date() }
        }
      }),
      Consent.count({ where: { ...where, revoked: true } }),
      Consent.count({
        where: {
          ...where,
          revoked: false,
          expiration_date: { [Consent.sequelize.Op.lte]: new Date() }
        }
      })
    ]);
    
    const report = {
      generatedAt: new Date(),
      parameters: { start_date, end_date, organization },
      summary: {
        totalConsents,
        activeConsents,
        revokedConsents,
        expiredConsents,
        cms2025Compliant: consentsByScope.find(s => s.consent_scope === 'ONE_TO_ONE')?.get('count') || 0
      },
      breakdown: {
        byType: consentsByType.map(t => ({
          type: t.consent_type,
          count: parseInt(t.get('count'))
        })),
        byScope: consentsByScope.map(s => ({
          scope: s.consent_scope,
          count: parseInt(s.get('count'))
        }))
      }
    };
    
    res.json({
      success: true,
      report
    });
    
  } catch (error) {
    logger.error('❌ Error generating compliance report:', error);
    res.status(500).json({ error: 'Failed to generate compliance report' });
  }
});

// Bulk consent validation
router.post('/validate-bulk', [
  body('consents').isArray({ min: 1, max: 100 }).withMessage('Consents array required (max 100)'),
  body('consents.*.beneficiary_phone').isMobilePhone().withMessage('Valid phone number required'),
  body('consents.*.transfer_to_organization').notEmpty().withMessage('Transfer organization required')
], handleValidation, async (req, res) => {
  try {
    const { consents } = req.body;
    
    const validationPromises = consents.map(async (consentCheck) => {
      const consent = await Consent.findOne({
        where: {
          beneficiary_phone: consentCheck.beneficiary_phone,
          transfer_to_organization: consentCheck.transfer_to_organization,
          revoked: false,
          expiration_date: { [Consent.sequelize.Op.gt]: new Date() }
        },
        order: [['consent_datetime', 'DESC']]
      });
      
      return {
        beneficiary_phone: consentCheck.beneficiary_phone,
        transfer_to_organization: consentCheck.transfer_to_organization,
        valid: consent && consent.isValid(),
        consent_type: consent?.consent_type,
        consent_scope: consent?.consent_scope,
        cms_2025_compliant: consent?.consent_scope === 'ONE_TO_ONE'
      };
    });
    
    const results = await Promise.all(validationPromises);
    
    res.json({
      success: true,
      results,
      summary: {
        total: results.length,
        valid: results.filter(r => r.valid).length,
        invalid: results.filter(r => !r.valid).length,
        cms_compliant: results.filter(r => r.cms_2025_compliant).length
      }
    });
    
  } catch (error) {
    logger.error('❌ Error in bulk consent validation:', error);
    res.status(500).json({ error: 'Failed to validate consents' });
  }
});

module.exports = router;