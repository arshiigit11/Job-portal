/**
 * AppError — Custom operational error class.
 *
 * Usage:
 *   throw new AppError('User not found', 404);
 *   next(new AppError('Unauthorized', 401));
 *
 * The global error handler in server.js checks `err.isOperational`
 * to distinguish expected errors from unexpected crashes.
 */
class AppError extends Error {
  /**
   * @param {string} message   - Human-readable error message sent to the client.
   * @param {number} statusCode - HTTP status code (4xx for client, 5xx for server).
   */
  constructor(message, statusCode) {
    super(message);

    this.statusCode  = statusCode;
    this.status      = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true; // Marks this as a known, handled error

    // Capture the stack trace, excluding the constructor call itself
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
