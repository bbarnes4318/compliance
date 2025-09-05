const express = require('express');
const { body, validationResult } = require('express-validator');
const { logger } = require('../utils/logger');

const router = express.Router();

// Get training status for employee
router.get('/status/:employeeId', async (req, res) => {
  try {
    // Stub implementation - would integrate with LMS
    res.json({
      success: true,
      training: {
        employeeId: req.params.employeeId,
        fwaTrainingCompleted: true,
        initialTrainingCompleted: true,
        nextTrainingDue: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get training status' });
  }
});

// Record training completion
router.post('/complete', [
  body('employeeId').notEmpty(),
  body('trainingType').isIn(['FWA', 'COMPLIANCE', 'INITIAL']),
  body('completionDate').isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    // Stub implementation
    logger.info(`Training completed: ${req.body.trainingType} for employee ${req.body.employeeId}`);
    
    res.json({
      success: true,
      message: 'Training completion recorded'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record training completion' });
  }
});

module.exports = router;