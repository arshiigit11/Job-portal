'use strict';

// ─── Load environment variables FIRST ────────────────────────────────────────
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const connectDB  = require('./src/config/db');

// ─── Initialize Express App ───────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);

// ─── Connect to MongoDB ───────────────────────────────────────────────────────
connectDB();

// ─── Security Middleware ──────────────────────────────────────────────────────
// Sets secure HTTP headers (XSS, clickjacking, MIME sniffing, etc.)
// CSP is configured to allow inline scripts/styles used in our frontend pages.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        scriptSrcAttr:  ["'unsafe-inline'"],
        styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
        fontSrc:        ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
        imgSrc:         ["'self'", "data:", "blob:"],
        connectSrc:     ["'self'"],
        frameSrc:       ["'none'"],
        objectSrc:      ["'none'"],
      },
    },
  })
);


// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : [
      'http://localhost:3000',
      'http://localhost:5000',
      'http://localhost:5001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5000',
      'http://[::1]:5000',
      'https://job-portal-lilac-alpha.vercel.app'
    ];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., Postman, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy: origin ${origin} not allowed`));
    },
    credentials: true, // Allow cookies/auth headers cross-origin
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Body Parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));           // Parse JSON bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Parse URL-encoded bodies

// ─── HTTP Request Logger ──────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined')); // Apache-style logging for production
}

// ─── Global Rate Limiter ──────────────────────────────────────────────────────
// Prevents brute-force and DDoS attacks on all API endpoints
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,                  // Limit each IP to 200 requests per window
  standardHeaders: true,     // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
  },
});
app.use('/api', globalLimiter);

// ─── Serve Static Files (Frontend) ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/v1/auth',         require('./src/routes/authRoutes'));         // Phase 2 ✅
app.use('/api/v1/jobs',         require('./src/routes/jobRoutes'));           // Phase 3 ✅
app.use('/api/v1/applications', require('./src/routes/applicationRoutes'));   // Phase 3 ✅
app.use('/api/v1/alerts',       require('./src/routes/alertRoutes'));         // Phase X ✅
app.use('/api/v1/interviews',   require('./src/routes/interviewRoutes'));     // Phase X ✅

// ─── Health Check Endpoint ────────────────────────────────────────────────────
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Job Portal API is running 🚀',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// ─── Catch-All: Serve Frontend for Non-API Routes ────────────────────────────
// (SPA fallback — enables client-side routing)
app.get('*', (req, res) => {
  // Only serve index.html for non-API routes
  if (!req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.status(404).json({ success: false, message: 'API route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
// Must be defined AFTER all routes — Express identifies it by its 4 parameters.
// Translates Mongoose, JWT, and operational errors into consistent JSON responses.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let error = { ...err, message: err.message, name: err.name };

  // ── Mongoose: Invalid ObjectId (e.g. /jobs/not-a-valid-id) ────────────────
  if (error.name === 'CastError') {
    error.message    = `Resource not found. Invalid value for field: ${error.path}.`;
    error.statusCode = 404;
  }

  // ── Mongoose: Validation errors (required fields, enum mismatches, etc.) ──
  if (error.name === 'ValidationError') {
    const messages   = Object.values(err.errors).map((e) => e.message);
    error.message    = `Validation failed: ${messages.join('. ')}`;
    error.statusCode = 400;
  }

  // ── MongoDB: Duplicate key (E11000) — e.g. email already registered ───────
  if (error.code === 11000) {
    const field      = Object.keys(err.keyValue || {})[0] || 'field';
    error.message    = `An account with this ${field} already exists.`;
    error.statusCode = 409;
  }

  // ── JWT: Malformed token ──────────────────────────────────────────────────
  if (error.name === 'JsonWebTokenError') {
    error.message    = 'Invalid token. Please log in again.';
    error.statusCode = 401;
  }

  // ── JWT: Expired token ────────────────────────────────────────────────────
  if (error.name === 'TokenExpiredError') {
    error.message    = 'Your session has expired. Please log in again.';
    error.statusCode = 401;
  }

  const statusCode = error.statusCode || 500;
  const message    = error.message    || 'Internal Server Error';

  // Log the full error in development, suppress stack in production
  if (process.env.NODE_ENV === 'development') {
    console.error('💥  Error:', err);
  } else {
    // Only log unexpected 500s in production — operational errors are normal
    if (statusCode === 500) console.error(`💥  Unexpected Error:`, err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ─── Initialize Background Jobs ────────────────────────────────────────────────
const startAlertCron = require('./src/jobs/alertCron');
startAlertCron();

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;

const server = app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log(`║  🚀  Job Portal API                      ║`);
  console.log(`║  🌍  Port    : ${PORT}                         ║`);
  console.log(`║  🛠   Mode    : ${(process.env.NODE_ENV || 'development').padEnd(14)}         ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
// Handles SIGTERM (Docker / Kubernetes) and SIGINT (Ctrl+C)
const gracefulShutdown = (signal) => {
  console.log(`\n🛑  Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    console.log('🔌  HTTP server closed.');
    try {
      const mongoose = require('mongoose');
      await mongoose.connection.close();
      console.log('🔌  MongoDB connection closed.');
    } catch (err) {
      console.error('❌  Error closing MongoDB connection:', err.message);
    }
    process.exit(0);
  });

  // Force shutdown if graceful close takes too long (10s)
  setTimeout(() => {
    console.error('⚠️   Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ─── Unhandled Rejection & Exception Safety Nets ──────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌  Unhandled Promise Rejection:', reason);
  // Gracefully shut down to avoid undefined state
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error('❌  Uncaught Exception:', err.message);
  process.exit(1);
});

module.exports = app; // Exported for future testing with Jest/Supertest
