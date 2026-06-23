const multer = require('multer');
const path = require('path');
const AppError = require('../utils/AppError');

// Set up storage engine
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Save files to public/uploads/resumes
    cb(null, path.join(__dirname, '../../public/uploads/resumes'));
  },
  filename: function (req, file, cb) {
    // Generate a unique filename: resume-<userId>-<timestamp>.pdf
    const ext = path.extname(file.originalname);
    const userId = req.user ? req.user._id.toString() : 'guest';
    cb(null, `resume-${userId}-${Date.now()}${ext}`);
  }
});

// File filter to accept only PDF
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new AppError('Not a PDF! Please upload only PDF files.', 400), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB limit
  }
});

module.exports = upload;
