const mongoose = require('mongoose');

const interviewSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.ObjectId,
      ref: 'Job',
      required: true,
    },
    recruiterId: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    applicantId: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    applicationId: {
      type: mongoose.Schema.ObjectId,
      ref: 'Application',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'scheduled', 'completed', 'cancelled'],
      default: 'pending',
    },
    proposedTimes: {
      type: [Date],
      required: true,
      validate: [
        function (val) {
          return val.length > 0 && val.length <= 5;
        },
        'You must propose between 1 and 5 time slots.',
      ],
    },
    scheduledTime: {
      type: Date,
      default: null,
    },
    meetingLink: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const Interview = mongoose.model('Interview', interviewSchema);
module.exports = Interview;
