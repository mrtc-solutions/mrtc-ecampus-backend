const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

class EmailService {
    constructor() {
        this.transporter = null;
        this.initializeTransporter();
    }

    initializeTransporter() {
        try {
            this.transporter = nodemailer.createTransport({
                host: process.env.EMAIL_HOST,
                port: parseInt(process.env.EMAIL_PORT),
                secure: process.env.EMAIL_PORT === '465',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASSWORD
                }
            });
            console.log('✅ Email service initialized');
        } catch (error) {
            console.error('❌ Email service initialization failed:', error);
        }
    }

    // Send password reset email
    async sendPasswordResetEmail(email, resetToken, userId) {
        try {
            const resetLink = `${process.env.BASE_URL}/reset-password?token=${resetToken}&userId=${userId}`;
            
            const mailOptions = {
                from: `"MRTC eCampus" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Password Reset Request - MRTC eCampus',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #1e3a8a;">Password Reset Request</h2>
                        <p>Hello,</p>
                        <p>We received a request to reset your password for your MRTC eCampus account.</p>
                        <p>Click the button below to reset your password:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetLink}" 
                               style="background-color: #1e3a8a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                                Reset Password
                            </a>
                        </div>
                        <p>If you didn't request this, please ignore this email.</p>
                        <p>This link will expire in 1 hour.</p>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #666; font-size: 12px;">
                            MRTC eCampus - Empowering Malawi Through Digital Learning<br>
                            Email: stepstosucceed1@gmail.com<br>
                            Website: mrtc-ecampus.web.app
                        </p>
                    </div>
                `
            };

            await this.transporter.sendMail(mailOptions);
            console.log(`Password reset email sent to: ${email}`);
            return { success: true };
        } catch (error) {
            console.error('Error sending password reset email:', error);
            return { success: false, error: error.message };
        }
    }

    // Send welcome email
    async sendWelcomeEmail(email, userName) {
        try {
            const mailOptions = {
                from: `"MRTC eCampus" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Welcome to MRTC eCampus!',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #1e3a8a;">Welcome to MRTC eCampus! 🎉</h2>
                        <p>Hello ${userName},</p>
                        <p>Thank you for joining MRTC eCampus! We're excited to have you as part of our learning community.</p>
                        
                        <h3 style="color: #3b82f6;">Getting Started:</h3>
                        <ul>
                            <li>Complete your profile setup</li>
                            <li>Browse our course catalog</li>
                            <li>Start with a free course</li>
                            <li>Use our AI assistant for help</li>
                        </ul>
                        
                        <div style="background-color: #f8fafc; padding: 20px; border-radius: 5px; margin: 20px 0;">
                            <h4>Quick Links:</h4>
                            <p>
                                <a href="${process.env.BASE_URL}/courses" style="color: #1e3a8a;">Browse Courses</a> | 
                                <a href="${process.env.BASE_URL}/dashboard" style="color: #1e3a8a;">Your Dashboard</a> | 
                                <a href="${process.env.BASE_URL}/faq" style="color: #1e3a8a;">FAQ</a>
                            </p>
                        </div>
                        
                        <p>If you have any questions, our support team is here to help.</p>
                        
                        <p>Happy learning!<br>
                        <strong>The MRTC eCampus Team</strong></p>
                        
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #666; font-size: 12px;">
                            Empowering Malawi Through Digital Learning<br>
                            Contact: stepstosucceed1@gmail.com
                        </p>
                    </div>
                `
            };

            await this.transporter.sendMail(mailOptions);
            console.log(`Welcome email sent to: ${email}`);
            return { success: true };
        } catch (error) {
            console.error('Error sending welcome email:', error);
            return { success: false, error: error.message };
        }
    }

    // Send course enrollment confirmation
    async sendEnrollmentConfirmation(email, userName, courseName, courseId) {
        try {
            const courseLink = `${process.env.BASE_URL}/course/${courseId}`;
            
            const mailOptions = {
                from: `"MRTC eCampus" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: `Enrollment Confirmation: ${courseName}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #10b981;">Course Enrollment Confirmed! ✅</h2>
                        <p>Hello ${userName},</p>
                        <p>You have successfully enrolled in:</p>
                        
                        <div style="background-color: #f0f9ff; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #3b82f6;">
                            <h3 style="margin-top: 0; color: #1e3a8a;">${courseName}</h3>
                            <p>You can now access the course materials and start learning immediately.</p>
                            <a href="${courseLink}" style="color: #1e3a8a; font-weight: bold;">Go to Course →</a>
                        </div>
                        
                        <h3 style="color: #3b82f6;">Next Steps:</h3>
                        <ol>
                            <li>Start with the first lesson</li>
                            <li>Complete lessons in order</li>
                            <li>Take notes and practice</li>
                            <li>Complete assessments to earn certificate</li>
                        </ol>
                        
                        <p>Need help? Use our AI assistant or contact support.</p>
                        
                        <p>Best regards,<br>
                        <strong>MRTC eCampus Team</strong></p>
                    </div>
                `
            };

            await this.transporter.sendMail(mailOptions);
            console.log(`Enrollment email sent to: ${email}`);
            return { success: true };
        } catch (error) {
            console.error('Error sending enrollment email:', error);
            return { success: false, error: error.message };
        }
    }

    // Send certificate email
    async sendCertificateEmail(email, userName, courseName, certificateUrl) {
        try {
            const mailOptions = {
                from: `"MRTC eCampus" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: `🎓 Certificate Earned: ${courseName}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #8b5cf6;">Congratulations! 🎉</h2>
                        <p>Hello ${userName},</p>
                        <p>You have successfully completed <strong>${courseName}</strong> and earned your certificate!</p>
                        
                        <div style="text-align: center; margin: 30px 0;">
                            <div style="background-color: #f5f3ff; padding: 20px; border-radius: 10px; display: inline-block;">
                                <div style="font-size: 48px;">🏆</div>
                                <h3 style="color: #8b5cf6;">Certificate of Achievement</h3>
                                <p>${courseName}</p>
                            </div>
                        </div>
                        
                        <p>Download your certificate:</p>
                        <div style="text-align: center; margin: 20px 0;">
                            <a href="${certificateUrl}" 
                               style="background-color: #8b5cf6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                                📄 Download Certificate
                            </a>
                        </div>
                        
                        <p>You can also share your achievement on LinkedIn and other platforms.</p>
                        
                        <div style="background-color: #f8fafc; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <h4>What's Next?</h4>
                            <ul>
                                <li>Explore more advanced courses</li>
                                <li>Check out related career paths</li>
                                <li>Update your resume with new skills</li>
                                <li>Share your success story with us</li>
                            </ul>
                        </div>
                        
                        <p>Congratulations once again on this achievement!</p>
                        
                        <p>Best regards,<br>
                        <strong>The MRTC eCampus Team</strong></p>
                    </div>
                `
            };

            await this.transporter.sendMail(mailOptions);
            console.log(`Certificate email sent to: ${email}`);
            return { success: true };
        } catch (error) {
            console.error('Error sending certificate email:', error);
            return { success: false, error: error.message };
        }
    }

    // Send security alert
    async sendSecurityAlert(email, userName, alertType, details) {
        try {
            const mailOptions = {
                from: `"MRTC eCampus Security" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: `Security Alert: ${alertType}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #ef4444;">Security Alert ⚠️</h2>
                        <p>Hello ${userName},</p>
                        <p>We detected ${alertType} on your MRTC eCampus account.</p>
                        
                        <div style="background-color: #fef2f2; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ef4444;">
                            <p><strong>Details:</strong> ${details}</p>
                            <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                        </div>
                        
                        <p>If this was you, no action is needed.</p>
                        <p>If you didn't perform this action, please:</p>
                        <ol>
                            <li>Change your password immediately</li>
                            <li>Review your account activity</li>
                            <li>Contact support if needed</li>
                        </ol>
                        
                        <div style="text-align: center; margin: 20px 0;">
                            <a href="${process.env.BASE_URL}/security" 
                               style="background-color: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                                Review Account Security
                            </a>
                        </div>
                        
                        <p style="color: #666; font-size: 12px;">
                            This is an automated security alert from MRTC eCampus.
                        </p>
                    </div>
                `
            };

            await this.transporter.sendMail(mailOptions);
            console.log(`Security alert sent to: ${email}`);
            return { success: true };
        } catch (error) {
            console.error('Error sending security alert:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new EmailService();