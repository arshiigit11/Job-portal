const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

// ─── Sub-schema: Seeker-specific profile fields ─────────────────────────────────────
const seekerProfileSchema = new mongoose.Schema(
  {
    resume:   { type: String, default: null },
    headline: { type: String, trim: true, default: '' },
    bio: {
      type: String,
      maxlength: [1000, 'Bio cannot exceed 1000 characters'],
      default: '',
    },
    skills:     { type: [String], default: [] },
    experience: { type: String, default: '' },
    education:  { type: String, default: '' },

    // ── Academic Information ───────────────────────────────────────────────
    rollNumber:      { type: String, trim: true, default: '' },
    cgpa:            { type: Number, min: 0, max: 10, default: null },
    activeBacklogs:  { type: Number, min: 0, default: 0 },
    graduationYear:  { type: Number, default: null },
    percentage10th:  { type: Number, min: 0, max: 100, default: null },
    percentage12th:  { type: Number, min: 0, max: 100, default: null },
    department:      { type: String, trim: true, default: '' },

    // ── Dynamic rows ───────────────────────────────────────────────────
    projects: [{
      _id: false,
      title:       { type: String, trim: true, default: '' },
      description: { type: String, trim: true, default: '' },
      techStack:   { type: String, trim: true, default: '' },
      link:        { type: String, trim: true, default: '' },
    }],
    certifications: [{
      _id: false,
      name:   { type: String, trim: true, default: '' },
      issuer: { type: String, trim: true, default: '' },
      date:   { type: String, trim: true, default: '' },
      link:   { type: String, trim: true, default: '' },
    }],
    workExperience: [{
      _id: false,
      company:     { type: String, trim: true, default: '' },
      role:        { type: String, trim: true, default: '' },
      duration:    { type: String, trim: true, default: '' },
      description: { type: String, trim: true, default: '' },
    }],
  },
  { _id: false }
);

// ─── Sub-schema: Recruiter-specific profile fields ─────────────────────────────────────
const recruiterProfileSchema = new mongoose.Schema(
  {
    companyName:        { type: String, trim: true, default: '' },
    companyWebsite:     { type: String, trim: true, default: '' },
    companyDescription: {
      type: String,
      maxlength: [2000, 'Company description cannot exceed 2000 characters'],
      default: '',
    },
    industry:    { type: String, trim: true, default: '' },
    companySize: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+', ''],
      default: '',
    },
  },
  { _id: false }
);

// ─── Main User Schema ───────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: ['seeker', 'recruiter'],
        message: 'Role must be either "seeker" or "recruiter"',
      },
      required: [true, 'Role is required'],
    },
    avatar:   { type: String, default: null },
    phone:    { type: String, trim: true, default: null },
    location: { type: String, trim: true, default: null },
    isActive:         { type: Boolean, default: true },
    isEmailVerified:  { type: Boolean, default: false },
    seekerProfile:    { type: seekerProfileSchema,    default: null },
    recruiterProfile: { type: recruiterProfileSchema, default: null },
    passwordChangedAt:   { type: Date, default: null },
    passwordResetToken:  { type: String, default: null },
    passwordResetExpires:{ type: Date, default: null },
    lastLoginAt:         { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Virtual: Full Name ───────────────────────────────────────────────────────────────
const userVirtuals = [
  ['fullName', function() { return `${this.firstName} ${this.lastName}`; }],
];
userVirtuals.forEach(([name, getter]) => userSchema.virtual(name).get(getter));

// ─── Indexes ──────────────────────────────────────────────────────────────────────
const additionalIndexes = [
  [{ role: 1 }],
  [{ createdAt: -1 }],
];
additionalIndexes.forEach((args) => userSchema.index(...args));

// ─── Pre-save: Hash Password ────────────────────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
    if (!this.isNew) {
      this.passwordChangedAt = Date.now() - 1000;
    }
    next();
  } catch (err) {
    next(err);
  }
});

// ─── Pre-save: Initialize Role Profile ──────────────────────────────────────────────
userSchema.pre('save', function (next) {
  if (this.isNew) {
    if (this.role === 'seeker'    && !this.seekerProfile)    this.seekerProfile    = {};
    if (this.role === 'recruiter' && !this.recruiterProfile) this.recruiterProfile = {};
  }
  next();
});

// ─── Instance Methods ─────────────────────────────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  delete obj.__v;
  return obj;
};

// ─── Static Methods ───────────────────────────────────────────────────────────────────
userSchema.statics.findByEmailWithPassword = function (email) {
  return this.findOne({ email: email.toLowerCase(), isActive: true }).select('+password');
};

const User = mongoose.model('User', userSchema);
module.exports = User;
