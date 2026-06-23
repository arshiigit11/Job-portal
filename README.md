# TalentSync Job Portal 🚀

TalentSync is a modern, responsive, and fully-featured Job Portal application designed to connect job seekers with recruiters seamlessly. 

## ✨ Key Features

### For Job Seekers
* **Job Browsing & Searching:** Explore available jobs and filter by categories, salary, and location.
* **Easy Application Tracking:** Track the status of your applications (Pending, Shortlisted, Rejected, Hired) in real-time.
* **Job Alerts:** Set up custom daily/weekly job alerts to receive email notifications when new jobs matching your criteria are posted.
* **Interview Scheduling:** Receive interview requests, view proposed time slots, and confirm interview times.
* **Email Notifications:** Get instant email updates when your application status changes or an interview is requested.

### For Recruiters
* **Job Management:** Post, edit, and manage your job listings.
* **Applicant Tracking:** View all candidates who have applied to your jobs and manage their statuses.
* **Schedule Interviews:** Propose up to 3 interview time slots to candidates and provide meeting links directly through the dashboard.
* **Analytics Dashboard:** Keep track of your recruitment pipeline and applicant volume.

## 🛠️ Technology Stack

* **Frontend:** Vanilla HTML5, CSS3 (with Custom Properties for theming), Vanilla JavaScript
* **Backend:** Node.js, Express.js
* **Database:** MongoDB with Mongoose ODM
* **Authentication:** JSON Web Tokens (JWT) & bcrypt.js for secure password hashing
* **Email Service:** Nodemailer (configured with Ethereal Email for local testing)
* **Task Scheduling:** node-cron (for daily/weekly job alerts)

## 🚀 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) and [MongoDB](https://www.mongodb.com/) installed on your machine.

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/arshiigit11/Job-portal.git
   cd Job-portal
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Variables**
   Rename the `.env.example` file to `.env` and configure your local settings:
   ```env
   NODE_ENV=development
   PORT=5001
   MONGO_URI=mongodb://127.0.0.1:27017/job-portal
   JWT_SECRET=your_super_secret_jwt_key
   JWT_EXPIRE=30d
   EMAIL_HOST=smtp.ethereal.email
   EMAIL_PORT=587
   EMAIL_USER=your_ethereal_user
   EMAIL_PASS=your_ethereal_pass
   EMAIL_FROM=noreply@talentsync.com
   ```

4. **Start the Application**
   ```bash
   # Run the server in development mode
   npm run dev
   ```

5. **Open your browser**
   Visit `http://localhost:5001` to view the application.

## ✉️ Email Testing locally
Since this uses Ethereal Email for local development, whenever the backend sends an email (like an interview request or status update), it will log a `Preview URL` in your backend terminal. Click that URL to see the generated email in your browser!

## 🤝 Contributing
Feel free to fork the repository, open issues, and submit pull requests to help improve TalentSync!
