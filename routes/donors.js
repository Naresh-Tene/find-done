const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');
const Notification = require('../models/Notification');
const geolib = require('geolib');
const auth = require('../middleware/auth');
const router = express.Router();

// Get all available donors
router.get('/available', async (req, res) => {
  try {
    const { bloodType, lat, lng, radius = 50 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ message: 'Latitude and longitude are required' });
    }

    // Find eligible donors
    const donors = await User.find({
      userType: 'donor',
      isAvailable: true,
      isVerified: true,
      bloodType: bloodType ? { $in: getCompatibleBloodTypes(bloodType) } : { $exists: true },
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: radius * 1000 // Convert km to meters
        }
      }
    }).select('-password -medicalHistory');

    // Filter by eligibility and add distance
    const eligibleDonors = donors
      .filter(donor => donor.isEligibleToDonate())
      .map(donor => {
        const distance = geolib.getDistance(
          { latitude: parseFloat(lat), longitude: parseFloat(lng) },
          { latitude: donor.location.coordinates[1], longitude: donor.location.coordinates[0] }
        );
        return {
          ...donor.toObject(),
          distance: Math.round(distance / 1000 * 10) / 10 // Convert to km with 1 decimal
        };
      })
      .sort((a, b) => a.distance - b.distance);

    res.json({ donors: eligibleDonors });
  } catch (error) {
    console.error('Get donors error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update donor availability
router.put('/availability', auth, async (req, res) => {
  try {
    const { isAvailable, lastDonationDate } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const updateData = {};
    if (isAvailable !== undefined) updateData.isAvailable = isAvailable;
    if (lastDonationDate) updateData.lastDonationDate = new Date(lastDonationDate);

    const donor = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('-password');

    if (!donor) {
      return res.status(404).json({ message: 'Donor not found' });
    }

    res.json({ 
      message: 'Availability updated successfully',
      donor 
    });
  } catch (error) {
    console.error('Update availability error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update donor location
router.put('/location', auth, [
  body('coordinates').isArray({ min: 2, max: 2 }).withMessage('Coordinates must be [longitude, latitude]'),
  body('address').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { coordinates, address } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const donor = await User.findByIdAndUpdate(
      userId,
      {
        location: {
          type: 'Point',
          coordinates: coordinates
        },
        address: address || undefined
      },
      { new: true }
    ).select('-password');

    if (!donor) {
      return res.status(404).json({ message: 'Donor not found' });
    }

    res.json({ 
      message: 'Location updated successfully',
      donor 
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get donor profile
router.get('/profile/:id', async (req, res) => {
  try {
    const donor = await User.findById(req.params.id)
      .select('-password -medicalHistory')
      .populate('donationHistory');

    if (!donor || donor.userType !== 'donor') {
      return res.status(404).json({ message: 'Donor not found' });
    }

    res.json({ donor });
  } catch (error) {
    console.error('Get donor profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get donor statistics
router.get('/stats/:id', async (req, res) => {
  try {
    const donorId = req.params.id;
    
    const stats = await BloodRequest.aggregate([
      {
        $match: {
          'matchedDonors.donor': donorId,
          'matchedDonors.status': 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalDonations: { $sum: 1 },
          lastDonation: { $max: '$completedAt' }
        }
      }
    ]);

    const donor = await User.findById(donorId).select('lastDonationDate createdAt');
    
    res.json({
      totalDonations: stats[0]?.totalDonations || 0,
      lastDonation: stats[0]?.lastDonation || donor?.lastDonationDate,
      memberSince: donor?.createdAt,
      isEligible: donor?.isEligibleToDonate() || false
    });
  } catch (error) {
    console.error('Get donor stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to get compatible blood types
function getCompatibleBloodTypes(bloodType) {
  const compatibility = {
    'A+': ['A+', 'A-', 'O+', 'O-'],
    'A-': ['A-', 'O-'],
    'B+': ['B+', 'B-', 'O+', 'O-'],
    'B-': ['B-', 'O-'],
    'AB+': ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    'AB-': ['A-', 'B-', 'AB-', 'O-'],
    'O+': ['O+', 'O-'],
    'O-': ['O-']
  };
  
  return compatibility[bloodType] || [];
}

module.exports = router;
