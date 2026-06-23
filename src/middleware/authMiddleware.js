const jwt       = require('jsonwebtoken');
const User      = require('../models/User');
const AppError  = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { verifyToken } = require('../utils/jwtHelper');

// ─────────────────────────────────────────────────────────────────────────────
// protect — Verify JWT and attach the user to req.user
//
// Looks for the token in the Authorization header as a Bearer token.
// Guards any route that requires a logged-in user.
//
// Usage:
//   router.get('/me', protect, authController.getMe);
// ─────────────────────────────────────────────────────────────────────────────
exports.protect = catchAsync(async (req, res, next) => {
  // ── 1. Extract token from the Authorization header ────────────────────────
  let token;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return next(
      new AppError(
        'You are not logged in. Please log in to access this resource.',
        401
      )
    );
  }

  // ── 2. Verify the token (checks signature + expiry) ───────────────────────
  //    verifyToken() throws JsonWebTokenError or TokenExpiredError on failure.
  //    These are caught by catchAsync → next(err) → global error handler.
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(
        new AppError('Your session has expired. Please log in again.', 401)
      );
    }
    return next(
      new AppError('Invalid token. Please log in again.', 401)
    );
  }

  // ── 3. Check the user still exists in the database ───────────────────────
  //    Handles the case where an account was deleted after the token was issued.
  const currentUser = await User.findById(decoded.sub);
  if (!currentUser || !currentUser.isActive) {
    return next(
      new AppError(
        'The user belonging to this token no longer exists.',
        401
      )
    );
  }

  // ── 4. Check if user changed their password after the token was issued ────
  //    If yes, the old token is no longer valid — forces re-login.
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError(
        'Your password was recently changed. Please log in again.',
        401
      )
    );
  }

  // ── 5. Attach user and decoded payload to request ─────────────────────────
  req.user       = currentUser; // Full Mongoose document for downstream use
  req.user.id    = currentUser._id.toString(); // Convenience shorthand
  req.tokenPayload = decoded;   // Raw decoded payload { sub, role, iat, exp }

  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// authorize(...roles) — Role-based access control (RBAC) guard
//
// Must be called AFTER `protect` (which attaches req.user).
// Returns a middleware function that restricts access to the specified roles.
//
// Usage:
//   // Only recruiters can create jobs:
//   router.post('/jobs', protect, authorize('recruiter'), jobController.create);
//
//   // Both seekers and recruiters can view their profile:
//   router.get('/me', protect, authorize('seeker', 'recruiter'), authController.getMe);
//
// @param  {...string} roles - One or more allowed role strings
// @returns {Function}         Standard Express middleware
// ─────────────────────────────────────────────────────────────────────────────
exports.authorize = (...roles) => {
  return (req, res, next) => {
    // protect() must have run first — if req.user is missing, it's a setup error
    if (!req.user) {
      return next(
        new AppError(
          'authorize() must be used after the protect() middleware.',
          500
        )
      );
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          `Access denied. This action requires one of the following roles: ${roles.join(', ')}.`,
          403
        )
      );
    }

    next();
  };
};
