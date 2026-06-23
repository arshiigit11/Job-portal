const mongoose = require('mongoose');

// ─── Salary Sub-schema ────────────────────────────────────────────────────────
const salarySchema = new mongoose.Schema(
  {
    min: {
      type: Number,
      min: [0, 'Minimum salary cannot be negative'],
      default: null,
    },
    max: {
      type: Number,
      min: [0, 'Maximum salary cannot be negative'],
      default: null,
    },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      default: 'USD',
      maxlength: [3, 'Currency code must be 3 characters (e.g., USD, INR)'],
    },
    period: {
      type: String,
      enum: {
        values: ['hourly', 'monthly', 'yearly'],
        message: 'Salary period must be "hourly", "monthly", or "yearly"',
      },
      default: 'yearly',
    },
    isNegotiable: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

// ─── Main Job Schema ──────────────────────────────────────────────────────────
const jobSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Job title is required'],
      trim: true,
      maxlength: [150, 'Job title cannot exceed 150 characters'],
    },
    description: {
      type: String,
      required: [true, 'Job description is required'],
      trim: true,
      maxlength: [10000, 'Job description cannot exceed 10,000 characters'],
    },
    company: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true,
      maxlength: [150, 'Company name cannot exceed 150 characters'],
    },
    location: {
      type: String,
      required: [true, 'Job location is required'],
      trim: true,
      maxlength: [200, 'Location cannot exceed 200 characters'],
    },
    locationType: {
      type: String,
      enum: {
        values: ['on-site', 'remote', 'hybrid'],
        message: 'Location type must be "on-site", "remote", or "hybrid"',
      },
      default: 'on-site',
    },
    jobType: {
      type: String,
      enum: {
        values: ['full-time', 'part-time', 'contract', 'internship', 'freelance'],
        message: 'Job type must be one of: full-time, part-time, contract, internship, freelance',
      },
      default: 'full-time',
    },
    experienceLevel: {
      type: String,
      enum: {
        values: ['entry', 'mid', 'senior', 'lead', 'executive'],
        message: 'Experience level must be one of: entry, mid, senior, lead, executive',
      },
      default: 'mid',
    },
    salary: {
      type: salarySchema,
      default: () => ({}),
    },
    skills: {
      type: [String],
      default: [],
    },
    category: {
      type: String,
      trim: true,
      default: 'General',
    },
    applicationDeadline: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: ['open', 'closed', 'paused'],
        message: 'Job status must be "open", "closed", or "paused"',
      },
      default: 'open',
    },
    // Reference to the Recruiter who posted this job
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A job must be associated with a recruiter'],
    },
    viewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    applicationCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
jobSchema.index({ postedBy: 1 });
jobSchema.index({ status: 1 });
jobSchema.index({ category: 1 });
jobSchema.index({ createdAt: -1 });
// Full-text search index for title, description, company
jobSchema.index(
  { title: 'text', description: 'text', company: 'text', skills: 'text' },
  { name: 'job_text_search' }
);

// ─── Virtual: isExpired ───────────────────────────────────────────────────────
jobSchema.virtual('isExpired').get(function () {
  if (!this.applicationDeadline) return false;
  return this.applicationDeadline < new Date();
});

// ─── Virtual: formatted salary range ─────────────────────────────────────────
jobSchema.virtual('salaryRange').get(function () {
  if (!this.salary || (!this.salary.min && !this.salary.max)) return 'Not disclosed';
  const { min, max, currency, period } = this.salary;
  const fmt = (n) => n ? `${currency} ${n.toLocaleString()}` : null;
  if (min && max) return `${fmt(min)} – ${fmt(max)} / ${period}`;
  if (min) return `From ${fmt(min)} / ${period}`;
  return `Up to ${fmt(max)} / ${period}`;
});

// ─── Pre-save Middleware: Validate salary range ───────────────────────────────
jobSchema.pre('save', function (next) {
  if (
    this.salary &&
    this.salary.min !== null &&
    this.salary.max !== null &&
    this.salary.min > this.salary.max
  ) {
    return next(new Error('Minimum salary cannot be greater than maximum salary'));
  }
  next();
});

// ─── Static: Increment view count ────────────────────────────────────────────
/**
 * Atomically increments the viewCount for a job.
 * @param {string} jobId
 */
jobSchema.statics.incrementViewCount = function (jobId) {
  return this.findByIdAndUpdate(jobId, { $inc: { viewCount: 1 } });
};

// ─── Static: Increment application count ─────────────────────────────────────
/**
 * Atomically increments the applicationCount for a job.
 * @param {string} jobId
 */
jobSchema.statics.incrementApplicationCount = function (jobId) {
  return this.findByIdAndUpdate(jobId, { $inc: { applicationCount: 1 } });
};

const Job = mongoose.model('Job', jobSchema);

module.exports = Job;
