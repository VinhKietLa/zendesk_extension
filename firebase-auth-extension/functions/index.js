const { onRequest } = require("firebase-functions/v2/https");
const axios = require("axios");
const functions = require("firebase-functions");

// Apply CORS middleware
exports.exchangeOAuthCode = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
    cors: [
      "https://fhoemdooiakglcaagjginiofpddbhakf.chromiumapp.org",
      "chrome-extension://fhoemdooiakglcaagjginiofpddbhakf",
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
