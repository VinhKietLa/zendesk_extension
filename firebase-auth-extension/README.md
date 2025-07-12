# **Zendesk Helper**

**Zendesk Helper** is a Chrome extension designed to streamline your Zendesk workflow. This tool allows users to set auto-refresh intervals for tickets, mark important tickets, and receive reminders for high-priority tasks—all in a clean, intuitive interface that integrates seamlessly with Zendesk.

## **Features**

- **Auto-Refresh Tickets:** Customize the refresh interval for your Zendesk tickets, ensuring they stay up-to-date without the need for manual refreshing.
- **Important Tickets & Reminders:** Add important tickets with optional reminders, so you never miss critical tasks or deadlines. Set reminders for key tickets and receive notifications at the appropriate time.
- **Simple UI:** The extension features an easy-to-use interface, letting you manage your tickets with minimal effort.

## **Installation**

1. Go to the [Chrome Web Store](https://chromewebstore.google.com/detail/zendesk-helper/cglfkdbjmdipbcjgjhdnkoafkiealbkb) and search for **Zendesk Helper**.
2. Click on **Add to Chrome** to install the extension.
3. Once installed, you'll find the **Zendesk Helper** icon in your Chrome toolbar.

## **Development Setup**

1. Clone the repository:

   ```bash
   git clone https://github.com/VinhKietLa/zendesk_extension.git
   cd zendesk_extension
   ```

2. Install dependencies:

   ```bash
   npm install
   cd functions
   npm install
   cd ..
   ```

3. Create a `.env` file in the root directory with the following variables:

   ```env
   # Firebase Configuration
   VITE_FIREBASE_API_KEY=your-api-key
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   VITE_FIREBASE_APP_ID=your-app-id
   VITE_FIREBASE_MEASUREMENT_ID=your-measurement-id

   # OAuth Configuration
   VITE_OAUTH_CLIENT_ID=your-oauth-client-id
   ```

4. Set up Firebase Functions secrets:

   ```bash
   firebase functions:secrets:set CLIENT_ID
   firebase functions:secrets:set CLIENT_SECRET
   ```

5. Build the extension:

   ```bash
   npm run build
   ```

6. Load the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` directory

## **Development Workflow**

1. Start the development server:

   ```bash
   npm run dev
   ```

2. Make changes to the code
3. The extension will automatically rebuild
4. Reload the extension in Chrome to see changes

## **Deployment Process**

1. Build the extension:

   ```bash
   npm run build
   ```

2. Deploy Firebase Functions:

   ```bash
   firebase deploy --only functions
   ```

3. Deploy Firebase Hosting:

   ```bash
   firebase deploy --only hosting
   ```

4. Update the extension in Chrome Web Store:
   - Zip the contents of the `dist` directory
   - Upload the zip file to the Chrome Web Store Developer Dashboard

## **Troubleshooting**

### Common Issues

1. **"No Zendesk tabs found"**

   - Ensure you're on a Zendesk page
   - Check if the extension has the correct permissions
   - Try reloading the extension

2. **Google Sign-in Issues**

   - Verify Firebase configuration in `.env`
   - Check Firebase Functions logs for errors
   - Ensure OAuth client ID is correctly configured

3. **Build Errors**
   - Clear the `dist` directory
   - Run `npm install` to update dependencies
   - Check for missing environment variables

### Debugging

1. View extension logs:

   - Right-click the extension icon
   - Select "Inspect popup"
   - Check the Console tab

2. View Firebase Functions logs:
   ```bash
   firebase functions:log
   ```

## **Security Considerations**

1. **Environment Variables**

   - Never commit `.env` file to version control
   - Keep Firebase configuration secure
   - Use Firebase Functions secrets for sensitive data

2. **OAuth Security**

   - Client ID is public and safe to expose
   - Client secret is stored securely in Firebase Functions
   - Token exchange happens server-side

3. **Data Storage**

   - No sensitive data stored in localStorage
   - User data managed by Firebase Auth
   - Secure token handling

4. **API Security**
   - Firebase API key is public (by design)
   - CORS properly configured
   - Rate limiting implemented

## **Contributing**

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## **Contact**

For any questions or support, contact:

- Email: kietla@live.co.uk
- GitHub: [VinhKietLa](https://github.com/VinhKietLa/zendesk_extension)

## **License**

MIT

# Firebase Auth Extension

A Chrome extension that uses Firebase Authentication with Google OAuth.

## Setup

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:

   ```env
   # Firebase Configuration
   VITE_FIREBASE_API_KEY=your-api-key
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   VITE_FIREBASE_APP_ID=your-app-id
   VITE_FIREBASE_MEASUREMENT_ID=your-measurement-id

   # OAuth Configuration
   VITE_OAUTH_CLIENT_ID=your-oauth-client-id
   ```

4. Set up Firebase Functions secrets:

   ```bash
   firebase functions:secrets:set CLIENT_ID
   firebase functions:secrets:set CLIENT_SECRET
   ```

5. Build the extension:

   ```bash
   npm run build
   ```

6. Load the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` directory

## Development

1. Start the development server:

   ```bash
   npm run dev
   ```

2. Make changes to the code
3. The extension will automatically rebuild

## Security Notes

- Never commit the `.env` file to version control
- Keep your OAuth client ID and secret secure
- The extension uses Firebase Authentication for secure user management
- All sensitive operations are performed through Firebase Functions

## License

MIT
