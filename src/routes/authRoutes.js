const express    = require('express');
const router     = express.Router();

const authController = require('../controllers/authController');
const { protect }    = require('../middleware/authMiddleware');
const upload         = require('../middleware/uploadMiddleware');

// ───────────────────────────────────────────────────────────────
//  Auth Routes — mounted at /api/v1/auth in server.js
// ───────────────────────────────────────────────────────────────
router.post('/register',           authController.register);
router.post('/login',              authController.login);
router.get('/me',  protect,        authController.getMe);
router.patch('/profile', protect,  authController.updateProfile);
router.post('/upload-resume', protect, upload.single('resume'), authController.uploadResume);

module.exports = router;
