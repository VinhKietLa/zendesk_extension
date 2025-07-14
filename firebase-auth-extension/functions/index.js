const { onRequest } = require("firebase-functions/v2/https");
const axios = require("axios");
const functions = require("firebase-functions");
const nodemailer = require("nodemailer");
const admin = require("firebase-admin");

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

// Initialize Gmail transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'kietla92@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Apply CORS middleware - Updated for new extension ID
exports.exchangeOAuthCode = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
    cors: [
      "https://fhoemdooiakglcaagjginiofpddbhakf.chromiumapp.org",
      "chrome-extension://fhoemdooiakglcaagjginiofpddbhakf",
      "https://dijhibnhmmkdemodngbigpdpbfcjccfd.chromiumapp.org",
      "chrome-extension://dijhibnhmmkdemodngbigpdpbfcjccfd",
    ],
    invoker: "public",
  },
  async (req, res) => {
    // Set CORS headers
    res.set("Access-Control-Allow-Origin", req.headers.origin);
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    // Verify the origin
    const allowedOrigins = [
      "https://fhoemdooiakglcaagjginiofpddbhakf.chromiumapp.org",
      "chrome-extension://fhoemdooiakglcaagjginiofpddbhakf",
      "https://dijhibnhmmkdemodngbigpdpbfcjccfd.chromiumapp.org",
      "chrome-extension://dijhibnhmmkdemodngbigpdpbfcjccfd",
    ];

    if (!allowedOrigins.includes(req.headers.origin)) {
      console.error("Unauthorized origin:", req.headers.origin);
      res.status(403).json({ error: "Unauthorized origin" });
      return;
    }

    const { code, redirectUri } = req.body;

    if (!code || !redirectUri) {
      console.error("Missing required parameters:", { code, redirectUri });
      res.status(400).json({ error: "Missing code or redirectUri" });
      return;
    }

    try {
      // Get environment variables
      const clientId = process.env.CLIENT_ID;
      const clientSecret = process.env.CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error("Missing required environment variables");
      }

      const tokenExchangeData = {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      };

      const tokenRes = await axios.post(
        "https://oauth2.googleapis.com/token",
        tokenExchangeData
      );

      const { id_token, access_token } = tokenRes.data;

      if (!id_token || !access_token) {
        console.error("Missing tokens in response:", tokenRes.data);
        throw new Error("Missing tokens from Google response");
      }

      res.status(200).json({
        idToken: id_token,
        accessToken: access_token,
      });
    } catch (err) {
      console.error("Token exchange error details:", {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });

      res.status(500).json({
        error: "Token exchange failed",
        details: err.response?.data || err.message,
      });
    }
  }
);

// Email reminder function
exports.sendReminderEmail = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    cors: [
      "https://fhoemdooiakglcaagjginiofpddbhakf.chromiumapp.org",
      "chrome-extension://fhoemdooiakglcaagjginiofpddbhakf",
      "https://dijhibnhmmkdemodngbigpdpbfcjccfd.chromiumapp.org",
      "chrome-extension://dijhibnhmmkdemodngbigpdpbfcjccfd",
    ],
    invoker: "public",
  },
  async (req, res) => {
    // Set CORS headers
    res.set("Access-Control-Allow-Origin", req.headers.origin);
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    // Verify the origin
    const allowedOrigins = [
      "https://fhoemdooiakglcaagjginiofpddbhakf.chromiumapp.org",
      "chrome-extension://fhoemdooiakglcaagjginiofpddbhakf",
      "https://dijhibnhmmkdemodngbigpdpbfcjccfd.chromiumapp.org",
      "chrome-extension://dijhibnhmmkdemodngbigpdpbfcjccfd",
    ];

    if (!allowedOrigins.includes(req.headers.origin)) {
      console.error("Unauthorized origin:", req.headers.origin);
      res.status(403).json({ error: "Unauthorized origin" });
      return;
    }

    const { idToken, reminderData } = req.body;

    if (!idToken || !reminderData) {
      console.error("Missing required parameters:", { idToken: !!idToken, reminderData: !!reminderData });
      res.status(400).json({ error: "Missing idToken or reminderData" });
      return;
    }

    try {
      // Verify the user's ID token
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const userId = decodedToken.uid;

      // Get user profile to check if email alerts are enabled
      const userDoc = await admin.firestore().collection("users").doc(userId).get();
      
      if (!userDoc.exists) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const userData = userDoc.data();
      
      // Check if user is Pro and has email alerts enabled
      if (!userData.isPro) {
        res.status(403).json({ error: "Email alerts are only available for Pro users" });
        return;
      }

      if (!userData.settings?.emailAlertsEnabled) {
        res.status(200).json({ message: "Email alerts disabled for this user" });
        return;
      }

      // Check if Gmail is configured
      if (!process.env.GMAIL_APP_PASSWORD) {
        console.error("Gmail app password not configured");
        res.status(500).json({ error: "Email service not configured" });
        return;
      }

      // Prepare email content
      const { ticketId, description, reminderTime } = reminderData;
      const userEmail = userData.email;
      const userName = userData.displayName || "Agent";

      const emailContent = {
        from: process.env.GMAIL_USER || 'agenthero.reminders@gmail.com',
        to: userEmail,
        subject: `🔔 Reminder: Ticket #${ticketId} - ${description}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="margin: 0; font-size: 24px;">🚀 Agent Hero Reminder</h1>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #e9ecef;">
              <h2 style="color: #495057; margin-top: 0;">Hello ${userName},</h2>
              
              <p style="color: #6c757d; font-size: 16px; line-height: 1.6;">
                This is a reminder for your Zendesk ticket:
              </p>
              
              <div style="background: white; border: 2px solid #007bff; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #007bff; margin-top: 0; font-size: 18px;">
                  🎫 Ticket #${ticketId}
                </h3>
                <p style="color: #495057; font-size: 16px; margin: 10px 0;">
                  <strong>Description:</strong> ${description}
                </p>
                ${reminderTime ? `
                <p style="color: #6c757d; font-size: 14px; margin: 10px 0;">
                  <strong>Reminder Time:</strong> ${new Date(reminderTime).toLocaleString()}
                </p>
                ` : ''}
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://your-zendesk-domain.com/agent/tickets/${ticketId}" 
                   style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                  📋 View Ticket
                </a>
              </div>
              
              <p style="color: #6c757d; font-size: 14px; margin-top: 30px; border-top: 1px solid #dee2e6; padding-top: 20px;">
                This email was sent by Agent Hero. You can manage your email preferences in the extension settings.
              </p>
            </div>
          </div>
        `,
        text: `
Agent Hero Reminder

Hello ${userName},

This is a reminder for your Zendesk ticket:

Ticket #${ticketId}
Description: ${description}
${reminderTime ? `Reminder Time: ${new Date(reminderTime).toLocaleString()}` : ''}

View ticket: https://your-zendesk-domain.com/agent/tickets/${ticketId}

This email was sent by Agent Hero. You can manage your email preferences in the extension settings.
        `
      };

      // Send the email using Gmail
      await transporter.sendMail(emailContent);

      console.log(`✅ Email sent successfully to ${userEmail} for ticket #${ticketId}`);
      
      res.status(200).json({ 
        success: true, 
        message: "Email sent successfully",
        sentTo: userEmail
      });

    } catch (error) {
      console.error("Error sending email:", error);
      
      if (error.code === 'auth/id-token-expired') {
        res.status(401).json({ error: "Token expired" });
      } else if (error.code === 'auth/id-token-revoked') {
        res.status(401).json({ error: "Token revoked" });
      } else {
        res.status(500).json({ 
          error: "Failed to send email",
          details: error.message 
        });
      }
    }
  }
);

// Test email function (for development/testing)
exports.testEmail = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    cors: [
      "https://fhoemdooiakglcaagjginiofpddbhakf.chromiumapp.org",
      "chrome-extension://fhoemdooiakglcaagjginiofpddbhakf",
      "https://dijhibnhmmkdemodngbigpdpbfcjccfd.chromiumapp.org",
      "chrome-extension://dijhibnhmmkdemodngbigpdpbfcjccfd",
    ],
    invoker: "public",
  },
  async (req, res) => {
    // Set CORS headers
    res.set("Access-Control-Allow-Origin", req.headers.origin);
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    const { idToken, testEmail } = req.body;

    if (!idToken) {
      res.status(400).json({ error: "Missing idToken" });
      return;
    }

    try {
      // Verify the user's ID token
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const userId = decodedToken.uid;

      // Get user profile
      const userDoc = await admin.firestore().collection("users").doc(userId).get();
      
      if (!userDoc.exists) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const userData = userDoc.data();
      
      // Check if user is Pro
      if (!userData.isPro) {
        res.status(403).json({ error: "Test emails are only available for Pro users" });
        return;
      }

      // Check if Gmail is configured
      if (!process.env.GMAIL_APP_PASSWORD) {
        console.error("Gmail app password not configured");
        res.status(500).json({ error: "Email service not configured" });
        return;
      }

      const emailContent = {
        from: process.env.GMAIL_USER || 'agenthero.reminders@gmail.com',
        to: testEmail || userData.email,
        subject: "🧪 Agent Hero - Test Email",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="margin: 0; font-size: 24px;">🧪 Agent Hero Test Email</h1>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 0 0 10px 10px; border: 1px solid #e9ecef;">
              <h2 style="color: #495057; margin-top: 0;">Hello ${userData.displayName || "Agent"},</h2>
              
              <p style="color: #6c757d; font-size: 16px; line-height: 1.6;">
                This is a test email to verify that your email alerts are working correctly!
              </p>
              
              <div style="background: white; border: 2px solid #28a745; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #28a745; margin-top: 0; font-size: 18px;">
                  ✅ Email Alerts Working
                </h3>
                <p style="color: #495057; font-size: 16px; margin: 10px 0;">
                  Your email alerts are now configured and ready to use. You'll receive emails when your reminders are due.
                </p>
              </div>
              
              <p style="color: #6c757d; font-size: 14px; margin-top: 30px; border-top: 1px solid #dee2e6; padding-top: 20px;">
                This is a test email from Agent Hero. You can manage your email preferences in the extension settings.
              </p>
            </div>
          </div>
        `,
        text: `
Agent Hero Test Email

Hello ${userData.displayName || "Agent"},

This is a test email to verify that your email alerts are working correctly!

✅ Email Alerts Working
Your email alerts are now configured and ready to use. You'll receive emails when your reminders are due.

This is a test email from Agent Hero. You can manage your email preferences in the extension settings.
        `
      };

      // Send the email using Gmail
      await transporter.sendMail(emailContent);

      console.log(`✅ Test email sent successfully to ${emailContent.to}`);
      
      res.status(200).json({ 
        success: true, 
        message: "Test email sent successfully",
        sentTo: emailContent.to
      });

    } catch (error) {
      console.error("Error sending test email:", error);
      
      if (error.code === 'auth/id-token-expired') {
        res.status(401).json({ error: "Token expired" });
      } else if (error.code === 'auth/id-token-revoked') {
        res.status(401).json({ error: "Token revoked" });
      } else {
        res.status(500).json({ 
          error: "Failed to send test email",
          details: error.message 
        });
      }
    }
  }
);
