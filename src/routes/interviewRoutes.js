const express = require('express');
const router = express.Router();
const interviewController = require('../controllers/interviewController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);

router
  .route('/')
  .post(authorize('recruiter'), interviewController.proposeInterview);

router
  .route('/my')
  .get(interviewController.getMyInterviews);

router
  .route('/:id')
  .patch(authorize('seeker'), interviewController.respondToInterview);

module.exports = router;
