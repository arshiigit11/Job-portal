const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: [true, 'An alert must belong to a user'],
    },
    keyword: {
      type: String,
      required: [true, 'An alert must have a keyword (e.g. Software Engineer)'],
      trim: true,
    },
    location: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent a user from creating identical alerts
alertSchema.index({ user: 1, keyword: 1, location: 1 }, { unique: true });

const Alert = mongoose.model('Alert', alertSchema);
module.exports = Alert;
