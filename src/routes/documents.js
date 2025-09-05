const express = require('express');
const multer = require('multer');
const { body, query, param, validationResult } = require('express-validator');
const documentRetentionService = require('../services/documentRetention');
const { authorizeDataAccess } = require('../middleware/auth');
const { logger, logHelpers } = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 10
  },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/jpeg',
      'image/png',
      'audio/mpeg',
      'audio/wav'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  }
});

// Upload document
router.post('/', upload.single('file'), [
  body('document_type').isIn([
    'CONSENT_FORM', 'ENROLLMENT_RECORD', 'TRAINING_CERTIFICATE', 
    'SCREENING_REPORT', 'AUDIT_REPORT', 'INVESTIGATION_FILE',
    'CALL_RECORDING', 'POLICY_DOCUMENT', 'COMPLIANCE_RECORD'
  ]).withMessage('Invalid document type'),
  body('category').isIn([
    'MEMBER_ENROLLMENT', 'CLINICAL', 'COMPLIANCE', 'TRAINING', 
    'INVESTIGATION', 'AUDIT', 'OPERATIONAL', 'LEGAL'
  ]).withMessage('Invalid category'),
  body('title').optional(),
  body('description').optional(),
  body('beneficiary_id').optional(),
  body('employee_id').optional()
], authorizeDataAccess('beneficiary_data'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const metadata = {
      documentType: req.body.document_type,
      category: req.body.category,
      title: req.body.title || req.file.originalname,
      description: req.body.description,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      beneficiaryId: req.body.beneficiary_id,
      employeeId: req.body.employee_id,
      createdBy: req.user.id,
      retentionYears: 10 // CMS requirement
    };

    const document = await documentRetentionService.storeDocument(req.file.buffer, metadata);

    logHelpers.document('DOCUMENT_UPLOADED', document.document_id, req.user.id, {
      type: metadata.documentType,
      category: metadata.category,
      size: req.file.size
    });

    res.status(201).json({
      success: true,
      document: {
        id: document.id,
        document_id: document.document_id,
        title: document.title,
        document_type: document.document_type,
        category: document.category,
        retention_date: document.retention_date
      }
    });

  } catch (error) {
    logger.error('Error uploading document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// Search documents
router.get('/search', [
  query('q').optional(),
  query('type').optional(),
  query('category').optional(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], async (req, res) => {
  try {
    const { q, type, category, page = 1, limit = 20 } = req.query;
    
    const results = await documentRetentionService.searchDocuments(q, {
      type,
      category,
      limit,
      offset: (page - 1) * limit
    });

    res.json({
      success: true,
      documents: results.rows,
      pagination: {
        total: results.count,
        page,
        limit,
        pages: Math.ceil(results.count / limit)
      }
    });

  } catch (error) {
    logger.error('Error searching documents:', error);
    res.status(500).json({ error: 'Failed to search documents' });
  }
});

module.exports = router;