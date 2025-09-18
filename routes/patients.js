const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');
const auth = require('../middleware/auth');
const router = express.Router();

// Create blood request
router.post('/request', auth, [
  body('bloodType').isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).withMessage('Invalid blood type'),
  body('urgency').isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid urgency level'),
  body('hospital.name').notEmpty().withMessage('Hospital name is required'),
  body('hospital.location.coordinates').isArray({ min: 2, max: 2 }).withMessage('Hospital coordinates are required'),
  body('requiredUnits').optional().isInt({ min: 1 }).withMessage('Required units must be at least 1')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      bloodType, 
      urgency, 
      hospital, 
      requiredUnits = 1, 
      description, 
      medicalNotes 
    } = req.body;

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Create blood request
    const bloodRequest = new BloodRequest({
      patient: userId,
      bloodType,
      urgency,
      hospital,
      requiredUnits,
      description,
      medicalNotes
    });

    await bloodRequest.save();

    // Populate patient details
    await bloodRequest.populate('patient', 'name phone email');

    res.status(201).json({
      message: 'Blood request created successfully',
      request: bloodRequest
    });
  } catch (error) {
    console.error('Create request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient's blood requests
router.get('/requests', auth, async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const requests = await BloodRequest.find({ patient: userId })
      .populate('matchedDonors.donor', 'name phone bloodType location address')
      .sort({ createdAt: -1 });

    res.json({ requests });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get specific blood request
router.get('/requests/:id', auth, async (req, res) => {
  try {
    const userId = req.user?.userId;
    const requestId = req.params.id;

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const request = await BloodRequest.findOne({ 
      _id: requestId, 
      patient: userId 
    }).populate('matchedDonors.donor', 'name phone bloodType location address');

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    res.json({ request });
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update blood request
router.put('/requests/:id', auth, [
  body('urgency').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('description').optional().isLength({ max: 500 }),
  body('medicalNotes').optional().isLength({ max: 1000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user?.userId;
    const requestId = req.params.id;
    const updates = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const request = await BloodRequest.findOneAndUpdate(
      { _id: requestId, patient: userId, status: { $in: ['active', 'matched'] } },
      updates,
      { new: true }
    ).populate('matchedDonors.donor', 'name phone bloodType location address');

    if (!request) {
      return res.status(404).json({ message: 'Request not found or cannot be updated' });
    }

    res.json({
      message: 'Request updated successfully',
      request
    });
  } catch (error) {
    console.error('Update request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Cancel blood request
router.put('/requests/:id/cancel', auth, [
  body('reason').optional().isLength({ max: 200 })
], async (req, res) => {
  try {
    const userId = req.user?.userId;
    const requestId = req.params.id;
    const { reason } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const request = await BloodRequest.findOneAndUpdate(
      { _id: requestId, patient: userId, status: { $in: ['active', 'matched'] } },
      {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason
      },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ message: 'Request not found or cannot be cancelled' });
    }

    res.json({
      message: 'Request cancelled successfully',
      request
    });
  } catch (error) {
    console.error('Cancel request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient profile
router.get('/profile', auth, async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const patient = await User.findById(userId).select('-password');
    if (!patient || patient.userType !== 'patient') {
      return res.status(404).json({ message: 'Patient not found' });
    }

    res.json({ patient });
  } catch (error) {
    console.error('Get patient profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const stats = await BloodRequest.aggregate([
      { $match: { patient: userId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalRequests = await BloodRequest.countDocuments({ patient: userId });
    const activeRequests = await BloodRequest.countDocuments({ 
      patient: userId, 
      status: { $in: ['active', 'matched'] } 
    });

    res.json({
      totalRequests,
      activeRequests,
      statusBreakdown: stats,
      memberSince: (await User.findById(userId)).createdAt
    });
  } catch (error) {
    console.error('Get patient stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
