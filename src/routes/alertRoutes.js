const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alertController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);
router.use(authorize('seeker'));

router
  .route('/')
  .get(alertController.getMyAlerts)
  .post(alertController.createAlert);

router
  .route('/:id')
  .delete(alertController.deleteAlert);

module.exports = router;
