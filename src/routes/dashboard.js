const express = require('express');
const { FWAIncident } = require('../models/FWAIncident');
const { Employee } = require('../models/Employee');
const { Consent } = require('../models/Consent');
const { Document } = require('../models/Document');

const router = express.Router();

// Get compliance dashboard data
router.get('/', async (req, res) => {
  try {
    const [
      activeEmployees,
      excludedEmployees,
      activeConsents,
      totalDocuments,
      activeFWAIncidents,
      recentActivity
    ] = await Promise.all([
      Employee.count({ where: { status: 'ACTIVE' } }),
      Employee.count({ where: { excluded_status: true } }),
      Consent.count({ 
        where: { 
          revoked: false,
          expiration_date: { [Consent.sequelize.Op.gt]: new Date() }
        }
      }),
      Document.count(),
      FWAIncident.count({ 
        where: { 
          status: { [FWAIncident.sequelize.Op.notIn]: ['RESOLVED', 'CLOSED'] }
        }
      }),
      // Recent activity stub
      []
    ]);

    const dashboard = {
      summary: {
        activeEmployees,
        excludedEmployees,
        activeConsents,
        totalDocuments,
        activeFWAIncidents,
        complianceScore: Math.round(((activeEmployees - excludedEmployees) / activeEmployees) * 100)
      },
      alerts: [],
      recentActivity,
      lastUpdated: new Date()
    };

    if (excludedEmployees > 0) {
      dashboard.alerts.push({
        type: 'WARNING',
        message: `${excludedEmployees} employees are on exclusion lists`,
        priority: 'HIGH'
      });
    }

    if (activeFWAIncidents > 0) {
      dashboard.alerts.push({
        type: 'INFO',
        message: `${activeFWAIncidents} active FWA investigations`,
        priority: 'MEDIUM'
      });
    }

    res.json({ success: true, dashboard });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

module.exports = router;