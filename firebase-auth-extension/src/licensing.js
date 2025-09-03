// Chrome Web Store Licensing Module

// Test mode flag - set to false for production
const TEST_MODE = false;

/**
 * Check if the user has a valid Pro license
 * @returns {Promise<boolean>} True if user has a valid Pro license
 */
export async function checkLicense() {
  try {
    // In test mode, simulate a license check
    if (TEST_MODE) {
      // Get test license status from local storage
      const data = await chrome.storage.sync.get("testLicenseStatus");
      const hasLicense = data.testLicenseStatus || false;

      // Store the license status
      await chrome.storage.sync.set({ hasProLicense: hasLicense });

      return hasLicense;
    }

    // Production mode - real license check
    const extensionId = chrome.runtime.id;

    if (!extensionId) {
      console.error("Extension ID not found");
      return false;
    }

    const license = await chrome.enterprise.deviceAttributes.getDeviceId();
    const hasLicense = license !== null;
    await chrome.storage.sync.set({ hasProLicense: hasLicense });
    return hasLicense;
  } catch (error) {
    console.error("Error checking license:", error);
    return false;
  }
}

/**
 * Toggle test license status (for development only)
 * @param {boolean} status - The new license status
 */
export async function setTestLicenseStatus(status) {
  if (!TEST_MODE) {
    console.warn("Test license functions are only available in test mode");
    return;
  }

  await chrome.storage.sync.set({ testLicenseStatus: status });
  await checkLicense(); // Refresh the license status
}

/**
 * Initialize the licensing system
 * @returns {Promise<void>}
 */
export async function initializeLicensing() {
  try {
    // Check license status
    const hasLicense = await checkLicense();

    // Update UI based on license status
    const proBadge = document.getElementById("proBadge");
    const upgradeBtn = document.getElementById("upgradeBtn");

    if (proBadge && upgradeBtn) {
      if (hasLicense) {
        proBadge.style.display = "inline-block";
        upgradeBtn.style.display = "none";
      } else {
        proBadge.style.display = "none";
        upgradeBtn.style.display = "inline-block";
      }
    }

    // Set up periodic license checks (every 24 hours)
    setInterval(checkLicense, 24 * 60 * 60 * 1000);
  } catch (error) {
    console.error("Error initializing licensing:", error);
  }
}

/**
 * Get the current license status
 * @returns {Promise<boolean>} True if user has a valid Pro license
 */
export async function getLicenseStatus() {
  try {
    const data = await chrome.storage.sync.get("hasProLicense");
    return data.hasProLicense || false;
  } catch (error) {
    console.error("Error getting license status:", error);
    return false;
  }
}
