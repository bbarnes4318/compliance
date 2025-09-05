const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { FWAIncident } = require('../models/FWAIncident');
const fwaDetectionService = require('../services/fwaDetection');
const { requireComplianceRole } = require('../middleware/auth');
const { logger, logHelpers } = require('../utils/logger');

const router = express.Router();

// Analyze call transcript for FWA
router.post('/analyze/call', [
  body('transcript').notEmpty().withMessage('Call transcript is required'),
  body('callId').optional(),
  body('agentId').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { transcript, callId, agentId } = req.body;
    
    const analysis = await fwaDetectionService.analyzeCallTranscript(transcript, {
      callId,
      agentId,
      userId: req.user.id
    });

    // Log FWA analysis
    logHelpers.fwa('CALL_ANALYSIS', {
      callId,
      agentId,
      riskLevel: analysis.riskLevel,
      confidence: analysis.confidence,
      patterns: analysis.patterns.length
    }, analysis.confidence);

    res.json({
      success: true,
      analysis
    });

  } catch (error) {
    logger.error('Error analyzing call transcript:', error);
    res.status(500).json({ error: 'Failed to analyze transcript' });
  }
});

// Get FWA incidents
router.get('/incidents', [
  query('status').optional().isIn(['REPORTED', 'UNDER_INVESTIGATION', 'RESOLVED', 'CLOSED']),
  query('severity').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], async (req, res) => {
  try {
    const { status, severity, page = 1, limit = 20 } = req.query;
    
    const where = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;
    
    const offset = (page - 1) * limit;
    
    const { count, rows } = await FWAIncident.findAndCountAll({
      where,
      limit,
      offset,
      order: [['reported_date', 'DESC']]
    });

    res.json({
      success: true,
      incidents: rows,
      pagination: {
        total: count,
        page,
        limit,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    logger.error('Error fetching FWA incidents:', error);
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

module.exports = router;