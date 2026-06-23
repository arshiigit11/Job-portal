const mongoose   = require('mongoose');
const Job        = require('../models/Job');
const AppError   = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

// ─── Internal Helper: Validate MongoDB ObjectId ───────────────────────────────
/**
 * Returns true if the string is a valid 24-hex MongoDB ObjectId.
 * Used to return a clean 404 before Mongoose emits a CastError.
 *
 * @param {string} id
 * @returns {boolean}
 */
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Create a new job listing
// @route   POST /api/v1/jobs
// @access  Private — Recruiter only
// ─────────────────────────────────────────────────────────────────────────────
exports.createJob = catchAsync(async (req, res, next) => {
  const {
    title,
    description,
    company,
    location,
    locationType,
    jobType,
    experienceLevel,
    salary,
    skills,
    category,
    applicationDeadline,
  } = req.body;

  // ── Validate required fields ──────────────────────────────────────────────
  if (!title || !description || !company || !location) {
    return next(
      new AppError('title, description, company, and location are required.', 400)
    );
  }

  // ── Create job — attach postedBy from the authenticated recruiter ─────────
  const job = await Job.create({
    title,
    description,
    company,
    location,
    locationType,
    jobType,
    experienceLevel,
    salary,
    skills:              Array.isArray(skills) ? skills : [],
    category,
    applicationDeadline: applicationDeadline || null,
    postedBy:            req.user._id, // Injected by protect() middleware
  });

  res.status(201).json({
    success: true,
    message: 'Job listing created successfully.',
    data: { job },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get all open jobs with optional query filtering & pagination
// @route   GET /api/v1/jobs
// @access  Public
//
// Supported query params:
//   ?search=      Full-text search across title, description, company, skills
//   ?location=    Partial, case-insensitive match on location string
//   ?category=    Exact match (case-insensitive)
//   ?jobType=     full-time | part-time | contract | internship | freelance
//   ?locationType= on-site | remote | hybrid
//   ?experienceLevel= entry | mid | senior | lead | executive
//   ?company=     Partial, case-insensitive match on company name
//   ?page=        Page number (default: 1)
//   ?limit=       Results per page (default: 10, max: 50)
//   ?sort=        newest (default) | oldest | salary_asc | salary_desc
// ─────────────────────────────────────────────────────────────────────────────
exports.getAllJobs = catchAsync(async (req, res, next) => {
  const {
    search,
    location,
    category,
    jobType,
    locationType,
    experienceLevel,
    company,
    sort  = 'newest',
    page  = '1',
    limit = '10',
  } = req.query;

  // ── Build the filter object ───────────────────────────────────────────────
  const filter = { status: 'open' }; // Only surface open listings

  // Full-text search ($text index defined on Job model)
  if (search && search.trim()) {
    filter.$text = { $search: search.trim() };
  }

  // Partial, case-insensitive location match (e.g. "remote", "New York")
  if (location && location.trim()) {
    filter.location = { $regex: location.trim(), $options: 'i' };
  }

  // Partial, case-insensitive company match
  if (company && company.trim()) {
    filter.company = { $regex: company.trim(), $options: 'i' };
  }

  // Exact enum matches — validated against model enums implicitly
  if (category)        filter.category        = { $regex: `^${category.trim()}$`, $options: 'i' };
  if (jobType)         filter.jobType         = jobType.trim();
  if (locationType)    filter.locationType    = locationType.trim();
  if (experienceLevel) filter.experienceLevel = experienceLevel.trim();

  // ── Build sort object ─────────────────────────────────────────────────────
  const SORT_MAP = {
    newest:      { createdAt: -1 },
    oldest:      { createdAt:  1 },
    salary_asc:  { 'salary.min':  1 },
    salary_desc: { 'salary.min': -1 },
  };
  // When doing text search, include relevance score and sort by it first
  const sortObj = search
    ? { score: { $meta: 'textScore' }, ...(SORT_MAP[sort] || SORT_MAP.newest) }
    : (SORT_MAP[sort] || SORT_MAP.newest);

  // ── Pagination ────────────────────────────────────────────────────────────
  const pageNum  = Math.max(1, parseInt(page,  10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
  const skip     = (pageNum - 1) * limitNum;

  // ── Execute query & count in parallel ────────────────────────────────────
  const projection = search ? { score: { $meta: 'textScore' } } : {};

  const [jobs, totalCount] = await Promise.all([
    Job.find(filter, projection)
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum)
      .populate('postedBy', 'firstName lastName recruiterProfile.companyName'),
    Job.countDocuments(filter),
  ]);

  const totalPages  = Math.ceil(totalCount / limitNum);

  res.status(200).json({
    success: true,
    results: jobs.length,
    pagination: {
      totalCount,
      totalPages,
      currentPage: pageNum,
      limit:       limitNum,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
    },
    data: { jobs },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get a single job by its ID
// @route   GET /api/v1/jobs/:id
// @access  Public
// ─────────────────────────────────────────────────────────────────────────────
exports.getJobById = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  // ── Guard: catch invalid ObjectId before Mongoose emits a CastError ───────
  if (!isValidObjectId(id)) {
    return next(new AppError(`No job found with id: ${id}`, 404));
  }

  const job = await Job.findById(id)
    .populate('postedBy', 'firstName lastName email recruiterProfile');

  if (!job) {
    return next(new AppError(`No job found with id: ${id}`, 404));
  }

  // ── Increment view counter (fire-and-forget — don't await) ───────────────
  Job.incrementViewCount(id).catch(() => {/* non-critical — fail silently */});

  res.status(200).json({
    success: true,
    data: { job },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get all jobs posted by the currently logged-in recruiter (all statuses)
// @route   GET /api/v1/jobs/my
// @access  Private — Recruiter only
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyJobs = catchAsync(async (req, res, next) => {
  const {
    status,
    sort  = 'newest',
    page  = '1',
    limit = '50',
  } = req.query;

  // Filter strictly by the logged-in recruiter — all statuses by default
  const filter = { postedBy: req.user._id };

  // Optional status filter
  const VALID_STATUSES = ['open', 'closed', 'paused'];
  if (status && VALID_STATUSES.includes(status)) {
    filter.status = status;
  }

  const SORT_MAP = {
    newest:      { createdAt: -1 },
    oldest:      { createdAt:  1 },
    salary_asc:  { 'salary.min':  1 },
    salary_desc: { 'salary.min': -1 },
  };
  const sortObj  = SORT_MAP[sort] || SORT_MAP.newest;

  const pageNum  = Math.max(1, parseInt(page,  10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip     = (pageNum - 1) * limitNum;

  const [jobs, totalCount] = await Promise.all([
    Job.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum)
      .populate('postedBy', 'firstName lastName recruiterProfile.companyName'),
    Job.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(totalCount / limitNum);

  res.status(200).json({
    success: true,
    results: jobs.length,
    pagination: {
      totalCount,
      totalPages,
      currentPage: pageNum,
      limit:       limitNum,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
    },
    data: { jobs },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Delete a job listing
// @route   DELETE /api/v1/jobs/:id
// @access  Private — Recruiter only + must be the original poster
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteJob = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  // ── Guard: invalid ObjectId ───────────────────────────────────────────────
  if (!isValidObjectId(id)) {
    return next(new AppError(`No job found with id: ${id}`, 404));
  }

  const job = await Job.findById(id);

  if (!job) {
    return next(new AppError(`No job found with id: ${id}`, 404));
  }

  // ── Ownership check: only the recruiter who posted the job can delete it ──
  // Compare as strings — Mongoose ObjectIds are objects, not primitives
  if (job.postedBy.toString() !== req.user._id.toString()) {
    return next(
      new AppError(
        'Forbidden. You do not have permission to delete this job listing.',
        403
      )
    );
  }

  await job.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Job listing deleted successfully.',
    data:    null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Update a job listing (status, details, etc.)
// @route   PATCH /api/v1/jobs/:id
// @access  Private — Recruiter only + must be the original poster
// ─────────────────────────────────────────────────────────────────────────────
exports.updateJob = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    return next(new AppError(`No job found with id: ${id}`, 404));
  }

  const job = await Job.findById(id);

  if (!job) {
    return next(new AppError(`No job found with id: ${id}`, 404));
  }

  // ── Ownership check ───────────────────────────────────────────────────────
  if (job.postedBy.toString() !== req.user._id.toString()) {
    return next(
      new AppError(
        'Forbidden. You do not have permission to update this job listing.',
        403
      )
    );
  }

  // ── Whitelist updatable fields to prevent mass assignment ─────────────────
  const UPDATABLE = [
    'title', 'description', 'location', 'locationType', 'jobType',
    'experienceLevel', 'salary', 'skills', 'category',
    'applicationDeadline', 'status',
  ];

  UPDATABLE.forEach((field) => {
    if (req.body[field] !== undefined) {
      job[field] = req.body[field];
    }
  });

  await job.save(); // Runs pre('save') validation including salary min/max check

  res.status(200).json({
    success: true,
    message: 'Job listing updated successfully.',
    data: { job },
  });
});
