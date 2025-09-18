const express = require('express');
const { body, validationResult } = require('express-validator');
const BloodRequest = require('../models/BloodRequest');
const User = require('../models/User');
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');
const router = express.Router();

// Get all active blood requests
router.get('/active', async (req, res) => {
  try {
    const { bloodType, urgency, lat, lng, radius = 100 } = req.query;

    let query = { status: { $in: ['active', 'matched'] } };

    if (bloodType) {
      query.bloodType = bloodType;
    }

    if (urgency) {
      query.urgency = urgency;
    }

    let requests = await BloodRequest.find(query)
      .populate('patient', 'name phone')
      .populate('matchedDonors.donor', 'name phone bloodType')
      .sort({ urgency: -1, createdAt: -1 });

    // Filter by location if provided
    if (lat && lng) {
      requests = requests.filter(request => {
        if (!request.hospital.location?.coordinates) return false;
        
        const distance = calculateDistance(
          parseFloat(lat),
          parseFloat(lng),
          request.hospital.location.coordinates[1],
          request.hospital.location.coordinates[0]
        );
        
        return distance <= parseFloat(radius);
      });
    }

    res.json({ requests });
  } catch (error) {
    console.error('Get active requests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get specific blood request
router.get('/:id', async (req, res) => {
  try {
    const request = await BloodRequest.findById(req.params.id)
      .populate('patient', 'name phone email')
      .populate('matchedDonors.donor', 'name phone bloodType location address');

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    res.json({ request });
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Respond to blood request (for donors)
router.post('/:id/respond', auth, [
  body('status').isIn(['accepted', 'declined']).withMessage('Status must be accepted or declined'),
  body('notes').optional().isLength({ max: 200 })
], async (req, res) => {
  try {
    const { status, notes } = req.body;
    const requestId = req.params.id;
    const donorId = req.user?.userId;

    if (!donorId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const request = await BloodRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'active' && request.status !== 'matched') {
      return res.status(400).json({ message: 'Request is no longer active' });
    }

    // Check if donor is already matched to this request
    const existingMatch = request.matchedDonors.find(
      match => match.donor.toString() === donorId
    );

    if (existingMatch) {
      // Update existing response
      existingMatch.status = status;
      existingMatch.respondedAt = new Date();
      existingMatch.notes = notes;
    } else {
      // Add new response
      request.matchedDonors.push({
        donor: donorId,
        status,
        respondedAt: new Date(),
        notes
      });
    }

    // Update request status if donor accepted
    if (status === 'accepted' && request.status === 'active') {
      request.status = 'matched';
    }

    await request.save();

    // Create notification for patient
    const notification = new Notification({
      recipient: request.patient,
      type: 'donor_response',
      title: 'Donor Response',
      message: `A donor has ${status} your blood request`,
      data: {
        requestId: request._id,
        donorId,
        status
      },
      priority: status === 'accepted' ? 'high' : 'medium'
    });

    await notification.save();

    res.json({
      message: `Response ${status} successfully`,
      request
    });
  } catch (error) {
    console.error('Respond to request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Complete blood request
router.post('/:id/complete', auth, async (req, res) => {
  try {
    const requestId = req.params.id;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const request = await BloodRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    // Check if user is the patient or an accepted donor
    const isPatient = request.patient.toString() === userId;
    const isAcceptedDonor = request.matchedDonors.some(
      match => match.donor.toString() === userId && match.status === 'accepted'
    );

    if (!isPatient && !isAcceptedDonor) {
      return res.status(403).json({ message: 'Not authorized to complete this request' });
    }

    if (request.status !== 'matched') {
      return res.status(400).json({ message: 'Request is not in matched status' });
    }

    // Update request status
    request.status = 'completed';
    request.completedAt = new Date();

    // Update donor's last donation date
    const acceptedDonor = request.matchedDonors.find(
      match => match.status === 'accepted'
    );

    if (acceptedDonor) {
      await User.findByIdAndUpdate(acceptedDonor.donor, {
        lastDonationDate: new Date(),
        isAvailable: false
      });
    }

    await request.save();

    res.json({
      message: 'Request completed successfully',
      request
    });
  } catch (error) {
    console.error('Complete request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get request statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const stats = await BloodRequest.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalRequests = await BloodRequest.countDocuments();
    const activeRequests = await BloodRequest.countDocuments({
      status: { $in: ['active', 'matched'] }
    });

    const urgencyStats = await BloodRequest.aggregate([
      {
        $group: {
          _id: '$urgency',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      totalRequests,
      activeRequests,
      statusBreakdown: stats,
      urgencyBreakdown: urgencyStats
    });
  } catch (error) {
    console.error('Get request stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in kilometers
  return distance;
}

module.exports = router;
