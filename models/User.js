const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  phone: {
    type: String,
    required: true
  },
  userType: {
    type: String,
    enum: ['donor', 'patient', 'admin'],
    required: true
  },
  bloodType: {
    type: String,
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    required: function() {
      return this.userType === 'donor';
    }
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: function() {
        return this.userType === 'donor';
      }
    }
  },
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  lastDonationDate: {
    type: Date,
    default: null
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  emergencyContact: {
    name: String,
    phone: String,
    relationship: String
  },
  medicalHistory: [{
    condition: String,
    date: Date,
    notes: String
  }],
  avatar: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Index for geospatial queries
userSchema.index({ location: '2dsphere' });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Check if donor is eligible
userSchema.methods.isEligibleToDonate = function() {
  if (this.userType !== 'donor') return false;
  if (!this.isAvailable) return false;
  if (!this.isVerified) return false;
  
  // Check if last donation was more than 56 days ago
  if (this.lastDonationDate) {
    const daysSinceLastDonation = (Date.now() - this.lastDonationDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastDonation < 56) return false;
  }
  
  return true;
};

module.exports = mongoose.model('User', userSchema);
