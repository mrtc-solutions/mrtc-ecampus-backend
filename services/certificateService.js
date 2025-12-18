const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

class CertificateService {
    constructor() {
        this.db = admin.firestore();
        this.storage = admin.storage();
    }

    // Generate certificate PDF
    async generateCertificate(userId, courseId, enrollmentId) {
        try {
            // Get user data
            const userDoc = await this.db.collection('users').doc(userId).get();
            if (!userDoc.exists) {
                throw new Error('User not found');
            }
            const user = userDoc.data();

            // Get course data
            const courseDoc = await this.db.collection('courses').doc(courseId).get();
            if (!courseDoc.exists) {
                throw new Error('Course not found');
            }
            const course = courseDoc.data();

            // Get enrollment data
            const enrollmentDoc = await this.db.collection('enrollments').doc(enrollmentId).get();
            if (!enrollmentDoc.exists) {
                throw new Error('Enrollment not found');
            }
            const enrollment = enrollmentDoc.data();

            // Verify certificate eligibility
            if (!enrollment.certificateEarned || enrollment.finalAssessmentScore < 80) {
                throw new Error('Certificate not earned');
            }

            // Create PDF
            const pdfDoc = await PDFDocument.create();
            const page = pdfDoc.addPage([800, 600]); // A4 landscape

            // Add fonts
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
            const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

            // Draw background
            page.drawRectangle({
                x: 0,
                y: 0,
                width: 800,
                height: 600,
                color: rgb(0.95, 0.95, 0.98),
            });

            // Add decorative border
            page.drawRectangle({
                x: 20,
                y: 20,
                width: 760,
                height: 560,
                borderColor: rgb(0.2, 0.4, 0.8),
                borderWidth: 3,
            });

            // Add header
            page.drawText('CERTIFICATE OF ACHIEVEMENT', {
                x: 250,
                y: 500,
                size: 28,
                font: fontBold,
                color: rgb(0.1, 0.3, 0.7),
            });

            page.drawText('This is to certify that', {
                x: 320,
                y: 450,
                size: 16,
                font: font,
                color: rgb(0.3, 0.3, 0.3),
            });

            // Add student name
            page.drawText(user.displayName.toUpperCase(), {
                x: 200,
                y: 380,
                size: 32,
                font: fontBold,
                color: rgb(0, 0, 0.5),
            });

            page.drawText('has successfully completed the course', {
                x: 240,
                y: 330,
                size: 16,
                font: font,
                color: rgb(0.3, 0.3, 0.3),
            });

            // Add course name
            page.drawText(course.title, {
                x: 150,
                y: 280,
                size: 24,
                font: fontBold,
                color: rgb(0.2, 0.4, 0.8),
                maxWidth: 500,
            });

            // Add details
            page.drawText(`Course ID: ${courseId}`, {
                x: 100,
                y: 220,
                size: 12,
                font: font,
                color: rgb(0.4, 0.4, 0.4),
            });

            page.drawText(`Completion Date: ${new Date().toLocaleDateString()}`, {
                x: 500,
                y: 220,
                size: 12,
                font: font,
                color: rgb(0.4, 0.4, 0.4),
            });

            page.drawText(`Score: ${enrollment.finalAssessmentScore}%`, {
                x: 100,
                y: 200,
                size: 12,
                font: fontBold,
                color: rgb(0.2, 0.6, 0.2),
            });

            page.drawText(`Certificate ID: CERT-${Date.now()}-${userId.substring(0, 8)}`, {
                x: 100,
                y: 180,
                size: 10,
                font: fontItalic,
                color: rgb(0.5, 0.5, 0.5),
            });

            // Add MRTC eCampus branding
            page.drawText('MRTC eCampus', {
                x: 350,
                y: 120,
                size: 18,
                font: fontBold,
                color: rgb(0.1, 0.3, 0.7),
            });

            page.drawText('Empowering Malawi Through Digital Learning', {
                x: 280,
                y: 100,
                size: 10,
                font: font,
                color: rgb(0.4, 0.4, 0.4),
            });

            page.drawText('mrtc-ecampus.web.app', {
                x: 340,
                y: 80,
                size: 10,
                font: fontItalic,
                color: rgb(0.3, 0.3, 0.3),
            });

            // Add signature lines
            page.drawText('_________________________', {
                x: 150,
                y: 40,
                size: 14,
                font: font,
                color: rgb(0.3, 0.3, 0.3),
            });

            page.drawText('Director, MRTC eCampus', {
                x: 170,
                y: 25,
                size: 10,
                font: font,
                color: rgb(0.4, 0.4, 0.4),
            });

            page.drawText('_________________________', {
                x: 500,
                y: 40,
                size: 14,
                font: font,
                color: rgb(0.3, 0.3, 0.3),
            });

            page.drawText('Date', {
                x: 570,
                y: 25,
                size: 10,
                font: font,
                color: rgb(0.4, 0.4, 0.4),
            });

            // Generate PDF bytes
            const pdfBytes = await pdfDoc.save();

            // Save to Firebase Storage
            const bucket = this.storage.bucket();
            const fileName = `certificates/${userId}/${courseId}_${Date.now()}.pdf`;
            const file = bucket.file(fileName);

            await file.save(pdfBytes, {
                metadata: {
                    contentType: 'application/pdf',
                    metadata: {
                        userId: userId,
                        courseId: courseId,
                        studentName: user.displayName,
                        courseName: course.title,
                        score: enrollment.finalAssessmentScore,
                        generatedAt: new Date().toISOString()
                    }
                }
            });

            // Make file publicly accessible
            await file.makePublic();

            // Get public URL
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

            // Save certificate record
            const certificateRef = this.db.collection('certificates').doc();
            await certificateRef.set({
                id: certificateRef.id,
                userId: userId,
                courseId: courseId,
                enrollmentId: enrollmentId,
                certificateUrl: publicUrl,
                downloadUrl: publicUrl,
                studentName: user.displayName,
                studentEmail: user.email,
                courseName: course.title,
                score: enrollment.finalAssessmentScore,
                issuedAt: admin.firestore.FieldValue.serverTimestamp(),
                certificateId: `CERT-${Date.now()}-${userId.substring(0, 8)}`,
                verified: true,
                metadata: {
                    courseCategory: course.category,
                    courseDuration: course.duration,
                    completionDate: new Date().toISOString()
                }
            });

            // Update enrollment with certificate info
            await this.db.collection('enrollments').doc(enrollmentId).update({
                certificateId: certificateRef.id,
                certificateUrl: publicUrl,
                certificateIssuedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return {
                success: true,
                certificateUrl: publicUrl,
                certificateId: certificateRef.id,
                downloadUrl: publicUrl,
                studentName: user.displayName,
                courseName: course.title,
                score: enrollment.finalAssessmentScore
            };
        } catch (error) {
            console.error('Certificate generation error:', error);
            return { success: false, error: error.message };
        }
    }

    // Get certificate by ID
    async getCertificate(certificateId) {
        try {
            const certDoc = await this.db.collection('certificates').doc(certificateId).get();
            
            if (!certDoc.exists) {
                throw new Error('Certificate not found');
            }

            return {
                success: true,
                certificate: certDoc.data()
            };
        } catch (error) {
            console.error('Get certificate error:', error);
            return { success: false, error: error.message };
        }
    }

    // Get user certificates
    async getUserCertificates(userId) {
        try {
            const certificatesQuery = await this.db.collection('certificates')
                .where('userId', '==', userId)
                .orderBy('issuedAt', 'desc')
                .get();

            const certificates = certificatesQuery.docs.map(doc => doc.data());
            
            return {
                success: true,
                certificates: certificates,
                count: certificates.length
            };
        } catch (error) {
            console.error('Get user certificates error:', error);
            return { success: false, error: error.message };
        }
    }

    // Verify certificate
    async verifyCertificate(certificateId) {
        try {
            const certDoc = await this.db.collection('certificates').doc(certificateId).get();
            
            if (!certDoc.exists) {
                return { success: false, valid: false, error: 'Certificate not found' };
            }

            const certificate = certDoc.data();
            
            // Additional verification logic can be added here
            const isValid = certificate.verified && 
                           certificate.score >= 80 &&
                           certificate.userId !== undefined;

            return {
                success: true,
                valid: isValid,
                certificate: certificate,
                verificationDate: new Date().toISOString()
            };
        } catch (error) {
            console.error('Certificate verification error:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new CertificateService();