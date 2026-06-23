/**
 * catchAsync — Wraps an async Express route handler.
 *
 * Eliminates the need for try/catch in every async controller.
 * Any thrown error or rejected promise is forwarded to Express's
 * next(err) pipeline, which lands in the global error handler.
 *
 * Usage:
 *   router.post('/register', catchAsync(authController.register));
 *
 * @param   {Function} fn - An async Express handler (req, res, next) => Promise
 * @returns {Function}      A standard Express middleware function
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

module.exports = catchAsync;
