const mongoose = require('mongoose');

const bloodRequestSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  bloodType: {
    type: String,
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    required: true
  },
  urgency: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  hospital: {
    name: {
      type: String,
      required: true
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true
      }
    },
    contact: {
      phone: String,
      email: String
    }
  },
  status: {
    type: String,
    enum: ['active', 'matched', 'completed', 'cancelled'],
    default: 'active'
  },
  matchedDonors: [{
    donor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'completed'],
      default: 'pending'
    },
    matchedAt: {
      type: Date,
      default: Date.now
    },
    respondedAt: Date,
    notes: String
  }],
  requiredUnits: {
    type: Number,
    default: 1,
    min: 1
  },
  description: {
    type: String,
    maxlength: 500
  },
  medicalNotes: {
    type: String,
    maxlength: 1000
  },
  completedAt: Date,
  cancelledAt: Date,
  cancellationReason: String
}, {
  timestamps: true
});

// Index for geospatial queries
bloodRequestSchema.index({ 'hospital.location': '2dsphere' });
bloodRequestSchema.index({ status: 1, urgency: -1, createdAt: -1 });

// Virtual for time since request
bloodRequestSchema.virtual('timeSinceRequest').get(function() {
  return Date.now() - this.createdAt.getTime();
});

// Method to get compatible blood types
bloodRequestSchema.methods.getCompatibleBloodTypes = function() {
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
  
  return compatibility[this.bloodType] || [];
};

// Method to check if request is still active
bloodRequestSchema.methods.isActive = function() {
  return this.status === 'active' || this.status === 'matched';
};

module.exports = mongoose.model('BloodRequest', bloodRequestSchema);
