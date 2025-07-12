import { defineConfig } from "vite";
import { resolve } from "path";
import fs from "fs";
import dotenv from "dotenv";

// Load environment variables from .env file
const result = dotenv.config();
console.log("Dotenv config result:", result);
console.log("Current working directory:", process.cwd());
console.log("Environment variables loaded:", process.env);

// Load environment variables with fallbacks
const env = {
  VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID:
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID,
  VITE_FIREBASE_MEASUREMENT_ID: process.env.VITE_FIREBASE_MEASUREMENT_ID,
  VITE_OAUTH_CLIENT_ID: process.env.VITE_OAUTH_CLIENT_ID,
};

// Log the environment variables we're trying to use
console.log("Environment variables being used:", env);

// Validate required environment variables
const requiredEnvVars = Object.keys(env);
const missingEnvVars = requiredEnvVars.filter((key) => !env[key]);
if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup.html"),
        background: resolve(__dirname, "src/background.js"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        manualChunks: undefined,
      },
    },
    outDir: "dist",
    emptyOutDir: true,
  },
  define: {
    "import.meta.env": JSON.stringify(env),
  },
  plugins: [
    {
      name: "copy-static-files",
      closeBundle() {
        const manifestSrc = resolve(__dirname, "src/manifest.json");
        const manifestDest = resolve(__dirname, "dist/manifest.json");

        const assetsDir = resolve(__dirname, "dist/assets");
        if (!fs.existsSync(assetsDir)) {
          console.warn("⚠️ dist/assets missing. Skipping background rewrite.");
          return;
        }

        const files = fs.readdirSync(assetsDir);
        const bgScript = files.find(
          (f) => f.startsWith("background") && f.endsWith(".js")
        );
        if (!bgScript) {
          throw new Error("❌ Background script not found in build output.");
        }

        // Read and process manifest.json
        const manifestContent = fs.readFileSync(manifestSrc, "utf-8");
        const manifest = JSON.parse(manifestContent);
        manifest.background.service_worker = `assets/${bgScript}`;
        manifest.action.default_popup = "popup.html";

        fs.writeFileSync(manifestDest, JSON.stringify(manifest, null, 2));

        const distSrcDir = resolve(__dirname, "dist/src");
        const filesToMove = ["popup.html"];

        filesToMove.forEach((file) => {
          const src = resolve(distSrcDir, file);
          const dest = resolve(__dirname, "dist", file);
          if (fs.existsSync(src)) {
            fs.renameSync(src, dest);
          }
        });

        if (fs.existsSync(distSrcDir)) {
          fs.rmdirSync(distSrcDir, { recursive: true });
        }
      },
    },
  ],
});
