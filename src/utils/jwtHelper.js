const jwt = require('jsonwebtoken');

// ─── Constants ────────────────────────────────────────────────────────────────
const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_ALGORITHM  = 'HS256';

// ─── Sign Token ───────────────────────────────────────────────────────────────
/**
 * Creates a signed JWT for a given user.
 *
 * Payload contains the minimum required claims:
 *   - sub  : User's MongoDB ObjectId (string) — standard JWT subject claim
 *   - role : User's role ('seeker' | 'recruiter') — avoids an extra DB lookup
 *             on every protected route
 *
 * @param   {object} user  - Mongoose User document
 * @returns {string}         Signed JWT string
 */
const signToken = (user) => {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables.');
  }

  // Accept either a Mongoose document (user._id exists) or a plain payload
  // object already containing { sub, role } — avoids the "Cannot read
  // properties of undefined (reading 'toString')" crash on registration/login.
  const sub  = user._id ? user._id.toString() : String(user.sub);
  const role = user.role;

  return jwt.sign(
    { sub, role },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      algorithm: JWT_ALGORITHM,
    }
  );
};

// ─── Verify Token ─────────────────────────────────────────────────────────────
/**
 * Verifies and decodes a JWT string.
 * Throws a JsonWebTokenError or TokenExpiredError if invalid.
 *
 * @param   {string} token - Raw JWT string (without 'Bearer ' prefix)
 * @returns {object}         Decoded payload { sub, role, iat, exp }
 */
const verifyToken = (token) => {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables.');
  }

  return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
};

// ─── Cookie Options (for future cookie-based auth) ────────────────────────────
/**
 * Returns cookie options for sending the JWT as an HttpOnly cookie.
 * This is unused in Phase 2 (we use Bearer headers) but pre-wired for Phase 5.
 *
 * @returns {object} Express cookie options
 */
const cookieOptions = () => ({
  httpOnly: true,                               // Inaccessible to JS — prevents XSS theft
  secure:   process.env.NODE_ENV === 'production', // HTTPS only in prod
  sameSite: 'strict',                           // CSRF protection
  maxAge:   7 * 24 * 60 * 60 * 1000,           // 7 days in ms
});

module.exports = { signToken, verifyToken, cookieOptions };
