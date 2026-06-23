const express    = require('express');
const router     = express.Router();

const jobController              = require('../controllers/jobController');
const { protect, authorize }     = require('../middleware/authMiddleware');

// ─────────────────────────────────────────────────────────────────────────────
//  Job Routes — mounted at /api/v1/jobs in server.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET  /api/v1/jobs
 * @desc    List all open jobs with filtering, search, and pagination
 * @access  Public
 *
 * Query params:
 *   ?search=react          Full-text search
 *   ?location=remote       Partial location match
 *   ?company=google        Partial company name match
 *   ?category=tech         Exact category match
 *   ?jobType=full-time     Enum filter
 *   ?locationType=hybrid   Enum filter
 *   ?experienceLevel=mid   Enum filter
 *   ?sort=newest|oldest|salary_asc|salary_desc
 *   ?page=1&limit=10
 *
 * @route   POST /api/v1/jobs
 * @desc    Create a new job listing
 * @access  Private — Recruiter only
 *
 * Body: { title, description, company, location, locationType, jobType,
 *         experienceLevel, salary, skills, category, applicationDeadline }
 */
router
  .route('/')
  .get(jobController.getAllJobs)
  .post(protect, authorize('recruiter'), jobController.createJob);

/**
 * @route   GET /api/v1/jobs/my
 * @desc    Get all jobs posted by the currently logged-in recruiter (all statuses)
 * @access  Private — Recruiter only
 *
 * NOTE: MUST be declared before /:id to prevent "my" being matched as a param.
 *
 * Query params:
 *   ?status=open|closed|paused   (optional, returns all if omitted)
 *   ?page=1&limit=50
 *   ?sort=newest|oldest
 */
router
  .route('/my')
  .get(protect, authorize('recruiter'), jobController.getMyJobs);

/**
 * @route   GET    /api/v1/jobs/:id
 * @desc    Get a single job by ID (also increments view count)
 * @access  Public
 *
 * @route   PATCH  /api/v1/jobs/:id
 * @desc    Update a job listing (owner only)
 * @access  Private — Recruiter + owner of the listing
 *
 * Body: any subset of updatable job fields
 *
 * @route   DELETE /api/v1/jobs/:id
 * @desc    Delete a job listing (owner only)
 * @access  Private — Recruiter + owner of the listing
 */
router
  .route('/:id')
  .get(jobController.getJobById)
  .patch(protect, authorize('recruiter'), jobController.updateJob)
  .delete(protect, authorize('recruiter'), jobController.deleteJob);

module.exports = router;
