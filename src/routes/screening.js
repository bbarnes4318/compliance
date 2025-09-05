const express = require('express');
const { body, validationResult } = require('express-validator');
const employeeScreeningService = require('../services/employeeScreening');
const { requireComplianceRole } = require('../middleware/auth');

const router = express.Router();

// Run monthly screening
router.post('/monthly', requireComplianceRole, async (req, res) => {
  try {
    const result = await employeeScreeningService.performMonthlyScreening();
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: 'Screening failed', message: error.message });
  }
});

// Pre-hire screening
router.post('/employee', [
  body('employee_id').notEmpty(),
  body('first_name').notEmpty(),
  body('last_name').notEmpty()
], requireComplianceRole, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const result = await employeeScreeningService.performPreHireScreening(req.body);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: 'Screening failed', message: error.message });
  }
});

// Generate screening report
router.get('/report', requireComplianceRole, async (req, res) => {
  try {
    const report = await employeeScreeningService.generateScreeningReport();
    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

module.exports = router;