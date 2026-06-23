const Interview = require('../models/Interview');
const Application = require('../models/Application');
const Job = require('../models/Job');
const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');
const sendEmail = require('../utils/email');

// @desc    Propose an interview (Recruiter)
// @route   POST /api/v1/interviews
// @access  Private (Recruiter)
exports.proposeInterview = catchAsync(async (req, res, next) => {
  const { applicationId, proposedTimes, meetingLink, notes } = req.body;

  if (!applicationId || !proposedTimes || !Array.isArray(proposedTimes) || proposedTimes.length === 0) {
    return next(new AppError('Please provide an applicationId and an array of proposedTimes.', 400));
  }

  const application = await Application.findById(applicationId);
  if (!application) {
    return next(new AppError('Application not found', 404));
  }

  const job = await Job.findById(application.jobId);
  if (!job) {
    return next(new AppError('Job not found', 404));
  }

  if (job.postedBy.toString() !== req.user.id) {
    return next(new AppError('Not authorized. You can only schedule interviews for your own jobs.', 403));
  }

  const applicant = await User.findById(application.applicantId);

  const interview = await Interview.create({
    jobId: job._id,
    recruiterId: req.user.id,
    applicantId: application.applicantId,
    applicationId: application._id,
    proposedTimes,
    meetingLink,
    notes,
  });

  // Send email to seeker
  if (applicant) {
    try {
      await sendEmail({
        to: applicant.email,
        subject: `TalentSync: Interview Request for ${job.title}`,
        text: `You have been invited to an interview for ${job.title} at ${job.company}. Log in to view proposed times and schedule.`,
        html: `
          <h2>Interview Request</h2>
          <p>Hi ${applicant.firstName},</p>
          <p>Great news! You have been invited to an interview for the <strong>${job.title}</strong> role at <strong>${job.company}</strong>.</p>
          <p>The recruiter has proposed some times. Please log in to your dashboard to select the time that works best for you.</p>
          <p><a href="http://localhost:5001/dashboard.html">Log in to TalentSync</a></p>
        `,
      });
    } catch (err) {
      console.error('Email error:', err);
    }
  }

  res.status(201).json({
    success: true,
    data: interview,
  });
});

// @desc    Respond to an interview proposal (Seeker)
// @route   PATCH /api/v1/interviews/:id
// @access  Private (Seeker)
exports.respondToInterview = catchAsync(async (req, res, next) => {
  const { scheduledTime, status } = req.body;
  const interview = await Interview.findById(req.params.id);

  if (!interview) {
    return next(new AppError('Interview not found', 404));
  }

  if (interview.applicantId.toString() !== req.user.id) {
    return next(new AppError('Not authorized', 403));
  }

  if (!['scheduled', 'rejected'].includes(status)) {
    return next(new AppError('Status must be scheduled or rejected', 400));
  }

  if (status === 'scheduled' && !scheduledTime) {
    return next(new AppError('Please provide the selected scheduledTime', 400));
  }

  interview.status = status;
  if (status === 'scheduled') {
    interview.scheduledTime = scheduledTime;
  }

  await interview.save();

  // Send email to recruiter
  try {
    const recruiter = await User.findById(interview.recruiterId);
    const job = await Job.findById(interview.jobId);
    if (recruiter && job) {
      await sendEmail({
        to: recruiter.email,
        subject: `TalentSync: Interview ${status === 'scheduled' ? 'Confirmed' : 'Declined'} for ${job.title}`,
        text: `The candidate has ${status} the interview. Log in to your dashboard to view details.`,
        html: `
          <h2>Interview Update</h2>
          <p>Hi ${recruiter.firstName},</p>
          <p>The candidate for <strong>${job.title}</strong> has <strong>${status}</strong> the interview request.</p>
          ${status === 'scheduled' ? `<p><strong>Confirmed Time:</strong> ${new Date(scheduledTime).toLocaleString()}</p>` : ''}
          <p><a href="http://localhost:5001/dashboard.html">Log in to TalentSync</a></p>
        `,
      });
    }
  } catch (err) {
    console.error('Email error:', err);
  }

  res.status(200).json({
    success: true,
    data: interview,
  });
});

// @desc    Get logged in user's interviews
// @route   GET /api/v1/interviews/my
// @access  Private
exports.getMyInterviews = catchAsync(async (req, res, next) => {
  const query = {};
  if (req.user.role === 'seeker') {
    query.applicantId = req.user.id;
  } else if (req.user.role === 'recruiter') {
    query.recruiterId = req.user.id;
  }

  const interviews = await Interview.find(query)
    .populate({
      path: 'jobId',
      select: 'title company',
    })
    .populate({
      path: 'applicantId',
      select: 'firstName lastName email',
    })
    .populate({
      path: 'recruiterId',
      select: 'firstName lastName email',
    })
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: interviews.length,
    data: interviews,
  });
});
