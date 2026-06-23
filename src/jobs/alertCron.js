const cron = require('node-cron');
const Alert = require('../models/Alert');
const Job = require('../models/Job');
const User = require('../models/User');
const sendEmail = require('../utils/email');

// Run every minute for testing (In production, this might be '0 9 * * *' for daily at 9am)
const startAlertCron = () => {
  cron.schedule('* * * * *', async () => {
    console.log('Running Job Alert Cron Job...');
    try {
      const activeAlerts = await Alert.find({ isActive: true }).populate('user');

      for (const alert of activeAlerts) {
        if (!alert.user) continue;

        // Base query for jobs matching the alert
        const query = {
          status: 'open',
          $or: [
            { title: { $regex: alert.keyword, $options: 'i' } },
            { description: { $regex: alert.keyword, $options: 'i' } },
          ],
        };

        if (alert.location) {
          query.location = { $regex: alert.location, $options: 'i' };
        }

        // Only look for jobs created after the alert was last processed
        // If lastSentAt is null, look for jobs created in the last 24 hours
        const sinceDate = alert.lastSentAt ? alert.lastSentAt : new Date(Date.now() - 24 * 60 * 60 * 1000);
        query.createdAt = { $gt: sinceDate };

        const matchingJobs = await Job.find(query);

        if (matchingJobs.length > 0) {
          // Send email
          const jobListHtml = matchingJobs.map(job => `<li><strong>${job.title}</strong> at ${job.company} - ${job.location}</li>`).join('');
          
          await sendEmail({
            to: alert.user.email,
            subject: `TalentSync: ${matchingJobs.length} new jobs found for "${alert.keyword}"`,
            text: `We found ${matchingJobs.length} new jobs matching your alert for "${alert.keyword}". Log in to TalentSync to apply.`,
            html: `
              <h2>Good news, ${alert.user.firstName}!</h2>
              <p>We found <strong>${matchingJobs.length}</strong> new jobs matching your alert for "<strong>${alert.keyword}</strong>":</p>
              <ul>${jobListHtml}</ul>
              <p><a href="http://localhost:5001/dashboard.html">Log in to TalentSync to apply</a></p>
            `,
          });

          // Update lastSentAt
          alert.lastSentAt = new Date();
          await alert.save();
        }
      }
    } catch (error) {
      console.error('Error running alert cron:', error);
    }
  });
};

module.exports = startAlertCron;
