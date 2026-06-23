const mongoose    = require('mongoose');
const Application = require('../models/Application');
const Job         = require('../models/Job');
const AppError    = require('../utils/AppError');
const catchAsync  = require('../utils/catchAsync');

// ─── Internal Helper: Validate MongoDB ObjectId ───────────────────────────────
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ─── Internal Helper: Fetch job & verify it belongs to the requester ──────────
/**
 * Finds a job by ID and verifies the requesting recruiter owns it.
 * Returns the job document on success, or calls next(err) on failure.
 *
 * @param {string}   jobId   - Job ObjectId string
 * @param {string}   userId  - Recruiter's ObjectId string (from req.user._id)
 * @param {Function} next    - Express next()
 * @returns {Promise<Document|null>} Job doc, or null if next() was called
 */
const findJobAndVerifyOwnership = async (jobId, userId, next) => {
  if (!isValidObjectId(jobId)) {
    next(new AppError(`No job found with id: ${jobId}`, 404));
    return null;
  }

  const job = await Job.findById(jobId);

  if (!job) {
    next(new AppError(`No job found with id: ${jobId}`, 404));
    return null;
  }

  if (job.postedBy.toString() !== userId.toString()) {
    next(
      new AppError(
        'Forbidden. You can only manage applications for jobs you posted.',
        403
      )
    );
    return null;
  }

  return job;
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Apply for a job
// @route   POST /api/v1/applications
// @access  Private — Seeker only
// ─────────────────────────────────────────────────────────────────────────────
exports.applyForJob = catchAsync(async (req, res, next) => {
  const { jobId, coverLetter } = req.body;

  // ── Validate jobId is present ─────────────────────────────────────────────
  if (!jobId) {
    return next(new AppError('jobId is required in the request body.', 400));
  }

  if (!isValidObjectId(jobId)) {
    return next(new AppError(`No job found with id: ${jobId}`, 404));
  }

  // ── Verify the job exists and is still open ───────────────────────────────
  const job = await Job.findById(jobId);

  if (!job) {
    return next(new AppError(`No job found with id: ${jobId}`, 404));
  }

  if (job.status !== 'open') {
    return next(
      new AppError(
        `This job listing is currently ${job.status} and is not accepting applications.`,
        400
      )
    );
  }

  // ── Prevent a seeker from applying to their own recruiter-listed job ──────
  // (Edge case: same person with both roles is theoretically impossible given
  //  the single-role constraint, but we guard explicitly for clarity.)
  if (job.postedBy.toString() === req.user._id.toString()) {
    return next(new AppError('You cannot apply for a job you posted.', 400));
  }

  // ── Check for duplicate application (compound index also enforces this) ───
  //  We do this check here to return a clean 409 instead of an E11000 error.
  const alreadyApplied = await Application.hasApplied(jobId, req.user._id);
  if (alreadyApplied) {
    return next(
      new AppError('You have already submitted an application for this job.', 409)
    );
  }

  // ── Create the application ────────────────────────────────────────────────
  const application = await Application.create({
    jobId,
    applicantId:    req.user._id,
    coverLetter:    coverLetter?.trim() || '',
    // Snapshot the seeker's resume URL at the time of application
    resumeSnapshot: req.user.seekerProfile?.resume || null,
  });

  // ── Atomically increment job's application counter (fire-and-forget) ──────
  Job.incrementApplicationCount(jobId).catch(() => {/* non-critical */});

  res.status(201).json({
    success: true,
    message: 'Application submitted successfully.',
    data:    { application },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get all applications submitted by the currently logged-in seeker
// @route   GET /api/v1/applications/my
// @access  Private — Seeker only
//
// Supported query params:
//   ?status=   Filter by application status (pending | reviewed | shortlisted | accepted | rejected)
//   ?page=     Page number (default: 1)
//   ?limit=    Results per page (default: 10, max: 50)
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyApplications = catchAsync(async (req, res, next) => {
  const { status, page = '1', limit = '10' } = req.query;

  const filter = { applicantId: req.user._id };

  // Optional status filter — only apply if it's a valid enum value
  const VALID_STATUSES = ['pending', 'reviewed', 'shortlisted', 'accepted', 'rejected'];
  if (status && VALID_STATUSES.includes(status)) {
    filter.status = status;
  }

  const pageNum  = Math.max(1, parseInt(page,  10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
  const skip     = (pageNum - 1) * limitNum;

  const [applications, totalCount] = await Promise.all([
    Application.find(filter)
      .sort({ createdAt: -1 }) // Most recent first
      .skip(skip)
      .limit(limitNum)
      // Populate the linked job — select only fields useful to the seeker
      .populate({
        path:   'jobId',
        select: 'title company location jobType locationType salary status postedBy',
        populate: {
          path:   'postedBy',
          select: 'firstName lastName recruiterProfile.companyName',
        },
      }),
    Application.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(totalCount / limitNum);

  res.status(200).json({
    success: true,
    results: applications.length,
    pagination: {
      totalCount,
      totalPages,
      currentPage: pageNum,
      limit:       limitNum,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
    },
    data: { applications },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get all applicants for a specific job (owned by the recruiter)
// @route   GET /api/v1/applications/job/:jobId
// @access  Private — Recruiter only + must own the job
//
// Supported query params:
//   ?status=   Filter applicants by status
//   ?page=     Page number (default: 1)
//   ?limit=    Results per page (default: 20, max: 100)
// ─────────────────────────────────────────────────────────────────────────────
exports.getJobApplicants = catchAsync(async (req, res, next) => {
  const { jobId }               = req.params;
  const { status, page = '1', limit = '20' } = req.query;

  // ── Verify the job exists AND belongs to this recruiter ──────────────────
  const job = await findJobAndVerifyOwnership(jobId, req.user._id, next);
  if (!job) return; // next(err) was already called inside the helper

  // ── Build filter ──────────────────────────────────────────────────────────
  const filter = { jobId };

  const VALID_STATUSES = ['pending', 'reviewed', 'shortlisted', 'accepted', 'rejected'];
  if (status && VALID_STATUSES.includes(status)) {
    filter.status = status;
  }

  const pageNum  = Math.max(1, parseInt(page,  10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip     = (pageNum - 1) * limitNum;

  // ── Fetch applications and aggregate status breakdown in parallel ─────────
  const [applications, totalCount, statusBreakdown] = await Promise.all([
    Application.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      // Populate applicant profile — only seeker-relevant public fields
      .populate({
        path:   'applicantId',
        select: 'firstName lastName email location seekerProfile.skills seekerProfile.experience seekerProfile.education',
      }),
    Application.countDocuments(filter),
    // Pipeline summary: how many applications per status for this job
    Application.getStatusBreakdown(jobId),
  ]);

  const totalPages = Math.ceil(totalCount / limitNum);

  res.status(200).json({
    success: true,
    results: applications.length,
    pagination: {
      totalCount,
      totalPages,
      currentPage: pageNum,
      limit:       limitNum,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
    },
    meta: {
      job: {
        id:    job._id,
        title: job.title,
      },
      // e.g. [{ _id: 'pending', count: 5 }, { _id: 'shortlisted', count: 2 }]
      statusBreakdown,
    },
    data: { applications },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Update the status of an application
// @route   PATCH /api/v1/applications/:id/status
// @access  Private — Recruiter only + must own the job the application is for
// ─────────────────────────────────────────────────────────────────────────────
exports.updateApplicationStatus = catchAsync(async (req, res, next) => {
  const { id }    = req.params;
  const { status, recruiterNotes } = req.body;

  // ── Validate application ID ───────────────────────────────────────────────
  if (!isValidObjectId(id)) {
    return next(new AppError(`No application found with id: ${id}`, 404));
  }

  // ── Validate status value ─────────────────────────────────────────────────
  const ALLOWED_STATUSES = ['pending', 'reviewed', 'shortlisted', 'accepted', 'rejected'];
  if (!status) {
    return next(new AppError('Please provide a status field in the request body.', 400));
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    return next(
      new AppError(
        `Invalid status. Must be one of: ${ALLOWED_STATUSES.join(', ')}.`,
        400
      )
    );
  }

  // ── Find the application ──────────────────────────────────────────────────
  const application = await Application.findById(id);

  if (!application) {
    return next(new AppError(`No application found with id: ${id}`, 404));
  }

  // ── Verify recruiter owns the job this application belongs to ─────────────
  // This is the critical ownership check: a recruiter must only be able to
  // update statuses for applications to their OWN jobs.
  const job = await findJobAndVerifyOwnership(
    application.jobId.toString(),
    req.user._id,
    next
  );
  if (!job) return; // next(err) already called

  // ── Update status using the instance method (records statusChangedAt) ─────
  await application.updateStatus(status);

  // ── Optionally save private recruiter notes ───────────────────────────────
  if (recruiterNotes !== undefined) {
    // Use findByIdAndUpdate to update the `select: false` field
    await Application.findByIdAndUpdate(id, {
      recruiterNotes: recruiterNotes.trim(),
    });
  }

  // ── Send Email Notification to Applicant ──────────────────────────────────
  try {
    const sendEmail = require('../utils/email');
    const User = require('../models/User');
    const applicant = await User.findById(application.applicantId);
    if (applicant) {
      await sendEmail({
        to: applicant.email,
        subject: `TalentSync: Application Status Update for ${job.title}`,
        text: `Your application for ${job.title} at ${job.company} is now marked as: ${status}. Log in to view details.`,
        html: `
          <h2>Application Update</h2>
          <p>Hi ${applicant.firstName},</p>
          <p>Your application for <strong>${job.title}</strong> at <strong>${job.company}</strong> has been updated to: <span style="text-transform: capitalize; font-weight: bold; color: #10b981;">${status}</span>.</p>
          <p><a href="http://localhost:5001/dashboard.html">Log in to TalentSync to view your applications</a></p>
        `,
      });
    }
  } catch (err) {
    console.error('Failed to send status update email:', err);
  }

  res.status(200).json({
    success: true,
    message: `Application status updated to "${status}".`,
    data: {
      application: {
        _id:             application._id,
        jobId:           application.jobId,
        applicantId:     application.applicantId,
        status:          application.status,
        statusChangedAt: application.statusChangedAt,
      },
    },
  });
});
