import { google } from "googleapis";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();

export const handler = async (event) => {
  try {
    const { title, description, driveFileName, driveFileBase64 } = JSON.parse(event.body);

    // GOOGLE DRIVE AUTH
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    const drive = google.drive({ version: "v3", auth });

    // UPLOAD FILE TO DRIVE
    const file = await drive.files.create({
      requestBody: {
        name: driveFileName,
        parents: [process.env.GOOGLE_DRIVE_UPLOADS_FOLDER_ID],
      },
      media: {
        mimeType: "application/pdf",
        body: Buffer.from(driveFileBase64, "base64"),
      },
    });

    // SAVE METADATA TO FIRESTORE
    await db.collection("courses").add({
      title,
      description,
      driveFileId: file.data.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    return { statusCode: 500, body: error.toString() };
  }
};
