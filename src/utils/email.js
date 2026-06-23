const nodemailer = require('nodemailer');

/**
 * Creates a transporter using Ethereal Email for testing.
 * In a real production app, you would use an SMTP service like SendGrid, AWS SES, or Mailgun.
 */
const createTransporter = async () => {
  // Generate a test account on the fly if credentials aren't provided in .env
  if (process.env.NODE_ENV === 'production') {
    // You'd put real SMTP config here
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Development: Use Ethereal fake SMTP
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: testAccount.user, // generated ethereal user
      pass: testAccount.pass, // generated ethereal password
    },
  });
};

/**
 * Sends an email
 * @param {Object} options - { to, subject, text, html }
 */
const sendEmail = async (options) => {
  try {
    const transporter = await createTransporter();

    const mailOptions = {
      from: '"TalentSync Alerts" <noreply@talentsync.com>', // sender address
      to: options.to, // list of receivers
      subject: options.subject, // Subject line
      text: options.text, // plain text body
      html: options.html, // html body
    };

    const info = await transporter.sendMail(mailOptions);

    console.log('\n--- EMAIL SENT ---');
    console.log('Message sent: %s', info.messageId);
    
    // Preview only available when sending through an Ethereal account
    if (nodemailer.getTestMessageUrl(info)) {
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
      console.log('------------------\n');
    }

    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    // Depending on requirements, we might not want to throw an error if email fails, 
    // to avoid breaking the main application flow (like submitting an application).
  }
};

module.exports = sendEmail;
