const Alert = require('../models/Alert');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

// @desc    Get logged in user's alerts
// @route   GET /api/v1/alerts
// @access  Private (Seeker)
exports.getMyAlerts = catchAsync(async (req, res, next) => {
  const alerts = await Alert.find({ user: req.user.id });

  res.status(200).json({
    success: true,
    count: alerts.length,
    data: alerts,
  });
});

// @desc    Create a new job alert
// @route   POST /api/v1/alerts
// @access  Private (Seeker)
exports.createAlert = catchAsync(async (req, res, next) => {
  req.body.user = req.user.id;

  try {
    const alert = await Alert.create(req.body);

    res.status(201).json({
      success: true,
      data: alert,
    });
  } catch (err) {
    if (err.code === 11000) {
      return next(new AppError('You already have an alert with this keyword and location.', 400));
    }
    return next(err);
  }
});

// @desc    Delete an alert
// @route   DELETE /api/v1/alerts/:id
// @access  Private (Seeker)
exports.deleteAlert = catchAsync(async (req, res, next) => {
  const alert = await Alert.findById(req.params.id);

  if (!alert) {
    return next(new AppError('Alert not found', 404));
  }

  // Make sure user owns the alert
  if (alert.user.toString() !== req.user.id) {
    return next(new AppError('Not authorized to delete this alert', 401));
  }

  await alert.deleteOne();

  res.status(200).json({
    success: true,
    data: {},
  });
});
