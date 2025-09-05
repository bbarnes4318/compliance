const express = require('express');
const { body, validationResult } = require('express-validator');
const fwaDetectionService = require('../services/fwaDetection');

const router = express.Router();

// Record call with FWA analysis
router.post('/record', [
  body('callId').notEmpty(),
  body('agentId').notEmpty(),
  body('beneficiaryPhone').optional(),
  body('transcript').optional(),
  body('duration').isNumeric()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    // Stub implementation for call recording
    const callRecord = {
      id: req.body.callId,
      agentId: req.body.agentId,
      duration: req.body.duration,
      timestamp: new Date(),
      fwaAnalysis: null
    };

    // Run FWA analysis if transcript provided
    if (req.body.transcript) {
      callRecord.fwaAnalysis = await fwaDetectionService.analyzeCallTranscript(
        req.body.transcript,
        { callId: req.body.callId, agentId: req.body.agentId }
      );
    }

    res.status(201).json({
      success: true,
      call: callRecord
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record call' });
  }
});

module.exports = router;