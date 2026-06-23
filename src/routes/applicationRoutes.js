const express    = require('express');
const router     = express.Router();

const appController              = require('../controllers/applicationController');
const { protect, authorize }     = require('../middleware/authMiddleware');

// ─────────────────────────────────────────────────────────────────────────────
//  Application Routes — mounted at /api/v1/applications in server.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /api/v1/applications
 * @desc    Submit a new job application
 * @access  Private — Seeker only
 *
 * Body: { jobId, coverLetter? }
 */
router
  .route('/')
  .post(protect, authorize('seeker'), appController.applyForJob);

/**
 * @route   GET /api/v1/applications/my
 * @desc    Get all applications submitted by the currently logged-in seeker
 * @access  Private — Seeker only
 *
 * Query params:
 *   ?status=pending|reviewed|shortlisted|accepted|rejected
 *   ?page=1&limit=10
 *
 * NOTE: This route MUST be defined BEFORE /:id to prevent Express from
 *       treating the literal string "my" as a dynamic :id parameter.
 */
router
  .route('/my')
  .get(protect, authorize('seeker'), appController.getMyApplications);

/**
 * @route   GET /api/v1/applications/job/:jobId
 * @desc    Get all applicants for a specific job (owned by the requester)
 * @access  Private — Recruiter only + must own the job
 *
 * Query params:
 *   ?status=pending|shortlisted|...
 *   ?page=1&limit=20
 */
router
  .route('/job/:jobId')
  .get(protect, authorize('recruiter'), appController.getJobApplicants);

/**
 * @route   PATCH /api/v1/applications/:id/status
 * @desc    Update the status of an application (shortlist, reject, etc.)
 * @access  Private — Recruiter only + must own the job the application is for
 *
 * Body: { status: 'pending'|'reviewed'|'shortlisted'|'accepted'|'rejected', recruiterNotes? }
 */
router
  .route('/:id/status')
  .patch(protect, authorize('recruiter'), appController.updateApplicationStatus);

module.exports = router;
