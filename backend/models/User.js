import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
    lowercase: true // Ensure username is stored lowercase for consistency
  },
  // Profile Data from Scrape (Raw JSON)
  profileData: {
    type: Object,
    default: {}
  },
  // Followers Data (Array of Cards)
  followers: {
    type: Array,
    default: []
  },
  // Original followers list from backend API (optional, can be large)
  rawFollowers: {
    type: Array,
    select: false // Don't return by default to save bandwidth
  },

  // Contact Info (Updated on purchase)
  fullName: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phoneNumber: { type: String, trim: true },
  
  // Payment Status
  isPaid: {
    type: Boolean,
    default: false
  },
  paymentDetails: {
    type: Object, // { orderId, paymentId, signature, ... }
    default: {}
  },
  
  // For verification
  verificationToken: String, // Random token if needed

  scrapedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true, // Automatically manages createdAt and updatedAt
  strict: false // Allow other fields if needed for flexibility
});

// Compound index for email lookup if needed later
UserSchema.index({ email: 1 });

const User = mongoose.model('User', UserSchema);
export default User;
