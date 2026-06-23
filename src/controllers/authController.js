const User        = require('../models/User');
const AppError    = require('../utils/AppError');
const catchAsync  = require('../utils/catchAsync');
const { signToken } = require('../utils/jwtHelper');
const bcrypt      = require('bcryptjs');

// ───────────────────────────────────────────────────────────────
// @desc    Register a new user
// @route   POST /api/v1/auth/register
// @access  Public
// ───────────────────────────────────────────────────────────────
exports.register = catchAsync(async (req, res, next) => {
  const { firstName, lastName, email, password, role, recruiterProfile, seekerProfile } = req.body;

  if (!firstName || !lastName || !email || !password || !role) {
    return next(new AppError('Please provide firstName, lastName, email, password and role.', 400));
  }

  const VALID_ROLES = ['seeker', 'recruiter'];
  if (!VALID_ROLES.includes(role)) {
    return next(new AppError(`Role must be one of: ${VALID_ROLES.join(', ')}.`, 400));
  }

  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    return next(new AppError('An account with this email address already exists.', 409));
  }

  // Build user data — include role-specific profile if provided
  const userData = { firstName, lastName, email, password, role };

  if (role === 'recruiter' && recruiterProfile) {
    userData.recruiterProfile = {
      companyName:        recruiterProfile.companyName        || '',
      companyWebsite:     recruiterProfile.companyWebsite     || '',
      companyDescription: recruiterProfile.companyDescription || '',
      industry:           recruiterProfile.industry           || '',
      companySize:        recruiterProfile.companySize        || '',
    };
  }

  if (role === 'seeker' && seekerProfile) {
    userData.seekerProfile = {
      rollNumber:    seekerProfile.rollNumber    || '',
      department:    seekerProfile.department    || '',
      graduationYear: seekerProfile.graduationYear || null,
    };
  }

  const user = await User.create(userData);
  const token = signToken({ sub: user._id, role: user.role });

  res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    token,
    data: { user: user.toSafeObject() },
  });
});

// ───────────────────────────────────────────────────────────────
// @desc    Login user
// @route   POST /api/v1/auth/login
// @access  Public
// ───────────────────────────────────────────────────────────────
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError('Please provide both email and password.', 400));
  }

  const user = await User.findByEmailWithPassword(email);
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Invalid email or password.', 401));
  }

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  const token = signToken({ sub: user._id, role: user.role });

  res.status(200).json({
    success: true,
    message: 'Logged in successfully.',
    token,
    data: { user: user.toSafeObject() },
  });
});

// ───────────────────────────────────────────────────────────────
// @desc    Get logged-in user's profile
// @route   GET /api/v1/auth/me
// @access  Private
// ───────────────────────────────────────────────────────────────
exports.getMe = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) return next(new AppError('User not found.', 404));

  res.status(200).json({
    success: true,
    data: { user: user.toSafeObject() },
  });
});

// ───────────────────────────────────────────────────────────────
// @desc    Update user profile (both common + role-specific fields)
// @route   PATCH /api/v1/auth/profile
// @access  Private
// ───────────────────────────────────────────────────────────────
exports.updateProfile = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) return next(new AppError('User not found.', 404));

  // — Common fields
  const commonFields = ['firstName', 'lastName', 'phone', 'location'];
  commonFields.forEach((f) => {
    if (req.body[f] !== undefined) {
      user[f] = (req.body[f] ?? '').toString().trim() || (f === 'firstName' || f === 'lastName' ? user[f] : null);
    }
  });

  if (user.role === 'seeker') {
    if (!user.seekerProfile) user.seekerProfile = {};
    const sp = user.seekerProfile;

    // String fields
    ['headline', 'bio', 'education', 'experience', 'rollNumber', 'department'].forEach((f) => {
      if (req.body[f] !== undefined) sp[f] = req.body[f];
    });

    // Skills: accept comma-separated string OR array
    if (req.body.skills !== undefined) {
      sp.skills = Array.isArray(req.body.skills)
        ? req.body.skills.map(s => s.trim()).filter(Boolean)
        : String(req.body.skills).split(',').map(s => s.trim()).filter(Boolean);
    }

    // Numeric fields
    const numFields = {
      cgpa:           { min: 0, max: 10 },
      activeBacklogs: { min: 0, max: 99 },
      graduationYear: { min: 1990, max: 2050 },
      percentage10th: { min: 0, max: 100 },
      percentage12th: { min: 0, max: 100 },
    };
    Object.entries(numFields).forEach(([field, { min, max }]) => {
      if (req.body[field] !== undefined) {
        const val = parseFloat(req.body[field]);
        sp[field] = (!isNaN(val) && val >= min && val <= max) ? val : null;
      }
    });

    // Array fields (validated to be arrays of objects)
    ['projects', 'certifications', 'workExperience'].forEach((f) => {
      if (Array.isArray(req.body[f])) sp[f] = req.body[f];
    });

    user.markModified('seekerProfile');

  } else if (user.role === 'recruiter') {
    if (!user.recruiterProfile) user.recruiterProfile = {};
    const rp = user.recruiterProfile;
    ['companyName', 'companyWebsite', 'companyDescription', 'industry', 'companySize'].forEach((f) => {
      if (req.body[f] !== undefined) rp[f] = req.body[f];
    });
    user.markModified('recruiterProfile');
  }

  await user.save({ validateBeforeSave: false });

  // Update nexus_user in response so client can refresh localStorage
  res.status(200).json({
    success: true,
    message: 'Profile updated successfully.',
    data: { user: user.toSafeObject() },
  });
});

// ───────────────────────────────────────────────────────────────
// @desc    Upload resume PDF
// @route   POST /api/v1/auth/upload-resume
// @access  Private
// ───────────────────────────────────────────────────────────────
exports.uploadResume = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) return next(new AppError('User not found.', 404));

  if (!req.file) {
    return next(new AppError('No file uploaded. Please upload a PDF.', 400));
  }

  // Generate the public URL path
  const resumeUrl = `/uploads/resumes/${req.file.filename}`;

  // Ensure seekerProfile exists
  if (!user.seekerProfile) {
    user.seekerProfile = {};
  }
  
  user.seekerProfile.resume = resumeUrl;
  user.markModified('seekerProfile');
  
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: 'Resume uploaded successfully.',
    data: { 
      resumeUrl: resumeUrl,
      user: user.toSafeObject() 
    },
  });
});
