const mongoose = require('mongoose');

// ─── Application Schema ───────────────────────────────────────────────────────
const applicationSchema = new mongoose.Schema(
  {
    // Reference to the Job being applied to
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: [true, 'Application must be linked to a job'],
    },
    // Reference to the Seeker who submitted the application
    applicantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Application must be linked to an applicant'],
    },
    coverLetter: {
      type: String,
      trim: true,
      maxlength: [5000, 'Cover letter cannot exceed 5,000 characters'],
      default: '',
    },
    resumeSnapshot: {
      type: String, // URL/path to the resume used at the time of application
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: ['pending', 'reviewed', 'shortlisted', 'accepted', 'rejected'],
        message:
          'Status must be one of: pending, reviewed, shortlisted, accepted, rejected',
      },
      default: 'pending',
    },
    // Recruiter notes (only visible to the recruiter, never exposed to seeker)
    recruiterNotes: {
      type: String,
      trim: true,
      maxlength: [2000, 'Recruiter notes cannot exceed 2,000 characters'],
      select: false, // Not returned in queries by default
      default: '',
    },
    // Timestamp when the status last changed
    statusChangedAt: {
      type: Date,
      default: null,
    },
    // Timestamp when the recruiter last viewed this application
    viewedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // createdAt = submission date, updatedAt = last modified
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Compound Unique Index ────────────────────────────────────────────────────
// Prevents a seeker from applying to the same job more than once
applicationSchema.index({ jobId: 1, applicantId: 1 }, { unique: true });

// ─── Additional Indexes ───────────────────────────────────────────────────────
applicationSchema.index({ applicantId: 1, createdAt: -1 }); // Seeker's application history
applicationSchema.index({ jobId: 1, status: 1 });           // Recruiter's pipeline filtering
applicationSchema.index({ status: 1 });

// ─── Virtual: isWithdrawn ─────────────────────────────────────────────────────
// This virtual flag is derived from a potential "withdrawn" status extension
// For now, serves as a semantic alias
applicationSchema.virtual('isPending').get(function () {
  return this.status === 'pending';
});

applicationSchema.virtual('isActive').get(function () {
  return !['rejected'].includes(this.status);
});

// ─── Pre-save Middleware: Track status change timestamp ───────────────────────
applicationSchema.pre('save', function (next) {
  if (this.isModified('status') && !this.isNew) {
    this.statusChangedAt = new Date();
  }
  next();
});

// ─── Instance Method: Mark as Viewed ─────────────────────────────────────────
/**
 * Records the timestamp when a recruiter views this application.
 * @returns {Promise<Document>}
 */
applicationSchema.methods.markAsViewed = function () {
  this.viewedAt = new Date();
  return this.save();
};

// ─── Instance Method: Update Status ──────────────────────────────────────────
/**
 * Updates the application status and records the change time.
 * @param {string} newStatus - One of: pending, reviewed, shortlisted, accepted, rejected
 * @returns {Promise<Document>}
 */
applicationSchema.methods.updateStatus = async function (newStatus) {
  const allowedStatuses = ['pending', 'reviewed', 'shortlisted', 'accepted', 'rejected'];
  if (!allowedStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }
  this.status = newStatus;
  this.statusChangedAt = new Date();
  return this.save();
};

// ─── Static Method: Get application stats for a job ──────────────────────────
/**
 * Returns a breakdown of application counts grouped by status for a given job.
 * @param {string} jobId
 * @returns {Promise<Array>}
 */
applicationSchema.statics.getStatusBreakdown = function (jobId) {
  return this.aggregate([
    { $match: { jobId: new mongoose.Types.ObjectId(jobId) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
};

// ─── Static Method: Check duplicate application ───────────────────────────────
/**
 * Checks whether a seeker has already applied to a job.
 * @param {string} jobId
 * @param {string} applicantId
 * @returns {Promise<boolean>}
 */
applicationSchema.statics.hasApplied = async function (jobId, applicantId) {
  const existing = await this.findOne({ jobId, applicantId });
  return !!existing;
};

const Application = mongoose.model('Application', applicationSchema);

module.exports = Application;
