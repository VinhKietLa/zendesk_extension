// Options Page JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Initialize options page
    initializeOptions();
    
    // Event listeners
    setupEventListeners();
    
    // Load saved settings
    loadSettings();
});

function initializeOptions() {
    console.log('Agent Hero Options Page Initialized');
    
    // Check auth state from storage instead of Firebase
    checkAuthState();
    
    // Listen for auth state changes from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'authStateChanged') {
            console.log('Auth state changed message received:', request);
            checkAuthState();
        }
    });
    
    // Listen for storage changes to update when pro status changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.user || changes.userProStatus)) {
            console.log('User or pro status changed, updating options page');
            checkAuthState();
        }
    });
}

function checkAuthState() {
    // Check if user is signed in by looking for user data in storage
    chrome.storage.sync.get(null, (allData) => {
        console.log('🔍 Options page checking ALL storage data:', allData);
        
        const user = allData.user;
        const pendingSignIn = allData.pendingSignIn;
        const userProStatus = allData.userProStatus;
        
        console.log('🔍 Extracted data:', { user, pendingSignIn, userProStatus });
        
        if (user) {
            // User is signed in, check pro status from storage
            const isPro = userProStatus || false;
            const plan = isPro ? 'Pro' : 'Free';
            console.log('👤 User signed in:', user.email, 'Pro status:', isPro, 'Plan:', plan);
            updateAccountInfo(plan, user.email);
            updateProFeaturesVisibility(plan);
        } else if (pendingSignIn) {
            // Sign-in in progress
            console.log('⏳ Sign-in in progress...');
            updateAccountInfo('Signing in...', null);
            updateProFeaturesVisibility('Free');
        } else {
            // User is not signed in
            console.log('❌ User not signed in');
            updateAccountInfo('Free', null);
            updateProFeaturesVisibility('Free');
        }
    });
}

function setupEventListeners() {
    // Header buttons
    const helpBtn = document.getElementById('helpBtn');
    const closeBtn = document.getElementById('closeBtn');
    
    if (helpBtn) {
        helpBtn.addEventListener('click', showHelpModal);
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeOptionsPage);
    }
    
    // Settings toggles
    const emailAlertsToggle = document.getElementById('emailAlertsToggle');
    const chromeNotificationsToggle = document.getElementById('chromeNotificationsToggle');
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    const workingHoursToggle = document.getElementById('workingHoursToggle');
    const darkModeToggle = document.getElementById('darkModeToggle');
    
    // Input fields
    const refreshInterval = document.getElementById('refreshInterval');
    const workStartTime = document.getElementById('workStartTime');
    const workEndTime = document.getElementById('workEndTime');
    
    // Buttons
    const upgradeBtn = document.getElementById('upgradeBtn');
    // Removed signInBtn logic
    
    // Add event listeners for toggles
    if (emailAlertsToggle) {
        emailAlertsToggle.addEventListener('change', saveSettings);
    }
    
    if (chromeNotificationsToggle) {
        chromeNotificationsToggle.addEventListener('change', saveSettings);
    }
    
    if (autoRefreshToggle) {
        autoRefreshToggle.addEventListener('change', saveSettings);
    }
    
    if (workingHoursToggle) {
        workingHoursToggle.addEventListener('change', saveSettings);
    }
    
    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', saveSettings);
    }
    
    // Add event listeners for inputs
    if (refreshInterval) {
        refreshInterval.addEventListener('change', saveSettings);
    }
    
    if (workStartTime) {
        workStartTime.addEventListener('change', saveSettings);
    }
    
    if (workEndTime) {
        workEndTime.addEventListener('change', saveSettings);
    }
    

    
    // Add event listeners for buttons
    if (upgradeBtn) {
        upgradeBtn.addEventListener('click', handleUpgrade);
    }
    
    const refreshAuthBtn = document.getElementById('refreshAuthBtn');
    if (refreshAuthBtn) {
        refreshAuthBtn.addEventListener('click', () => {
            console.log('🔄 Manual refresh of auth state requested');
            checkAuthState();
        });
    }
    // Removed signInBtn event listener
    
    // Help modal
    const closeHelpModal = document.getElementById('closeHelpModal');
    if (closeHelpModal) {
        closeHelpModal.addEventListener('click', hideHelpModal);
    }
    
    // Close modal when clicking outside
    const helpModal = document.getElementById('helpModal');
    if (helpModal) {
        helpModal.addEventListener('click', function(e) {
            if (e.target === helpModal) {
                hideHelpModal();
            }
        });
    }

    // Upgrade modal
    const closeUpgradeModal = document.getElementById('closeUpgradeModal');
    const upgradeModal = document.getElementById('upgradeModal');
    const activateProBtn = document.getElementById('activateProBtn');
    const restorePurchasesBtn = document.getElementById('restorePurchasesBtn');
    const resetProStatusBtn = document.getElementById('resetProStatusBtn');
    const setProStatusBtn = document.getElementById('setProStatusBtn');

    if (closeUpgradeModal) {
        closeUpgradeModal.addEventListener('click', () => {
            if (upgradeModal) upgradeModal.style.display = 'none';
        });
    }

    if (upgradeModal) {
        upgradeModal.addEventListener('click', function(e) {
            if (e.target === upgradeModal) {
                upgradeModal.style.display = 'none';
            }
        });
    }

    if (activateProBtn) {
        activateProBtn.addEventListener('click', async () => {
            try {
                // Show loading state
                activateProBtn.textContent = "Processing...";
                activateProBtn.disabled = true;

                console.log("🛒 Starting Pro purchase...");

                // Import the payments module
                const { purchasePro } = await import('./payments.js');

                // Attempt to purchase Pro subscription
                const result = await purchasePro();

                if (result.success) {
                    // Close modal
                    if (upgradeModal) upgradeModal.style.display = 'none';

                    // Update UI to show Pro status
                    updateAccountInfo('Pro', 'Pro User');
                    updateProFeaturesVisibility('Pro');

                    // Show success message
                    showSaveConfirmation();

                    console.log("✅ Pro upgrade completed successfully");
                } else {
                    // Show error message
                    alert(result.message || "Purchase failed. Please try again.");
                    console.log("❌ Pro purchase failed:", result.message);
                }

            } catch (error) {
                console.error("Error during Pro purchase:", error);
                alert("Payment error occurred. Please try again.");
            } finally {
                // Reset button state
                activateProBtn.textContent = "Upgrade Now";
                activateProBtn.disabled = false;
            }
        });
    }

    if (restorePurchasesBtn) {
        restorePurchasesBtn.addEventListener('click', async () => {
            try {
                // Show loading state
                restorePurchasesBtn.textContent = "Restoring...";
                restorePurchasesBtn.disabled = true;

                console.log("🔄 Restoring purchases...");

                // Import the payments module
                const { restorePurchases } = await import('./payments.js');

                // Attempt to restore purchases
                const restored = await restorePurchases();

                if (restored) {
                    // Close modal
                    if (upgradeModal) upgradeModal.style.display = 'none';

                    // Update UI to show Pro status
                    updateAccountInfo('Pro', 'Pro User');
                    updateProFeaturesVisibility('Pro');

                    // Show success message
                    showSaveConfirmation();

                    console.log("✅ Pro subscription restored");
                } else {
                    // Show message that no purchases were found
                    alert("No Pro subscription found to restore.");
                    console.log("ℹ️ No Pro subscription found");
                }

            } catch (error) {
                console.error("Error restoring purchases:", error);
                alert("Error restoring purchases. Please try again.");
            } finally {
                // Reset button state
                restorePurchasesBtn.textContent = "Restore Purchases";
                restorePurchasesBtn.disabled = false;
            }
        });
    }

    // Development mode controls
    if (resetProStatusBtn) {
        resetProStatusBtn.addEventListener('click', async () => {
            try {
                await chrome.storage.sync.set({ testProStatus: false });
                alert("Pro status reset to Free");
                
                // Update UI
                updateAccountInfo('Free', 'Free User');
                updateProFeaturesVisibility('Free');
                
                console.log("🧪 DEV MODE: Pro status reset to Free");
            } catch (error) {
                console.error("Error resetting Pro status:", error);
                alert("Error resetting Pro status");
            }
        });
    }

    if (setProStatusBtn) {
        setProStatusBtn.addEventListener('click', async () => {
            try {
                await chrome.storage.sync.set({ testProStatus: true });
                alert("Pro status set to Pro");
                
                // Update UI
                updateAccountInfo('Pro', 'Pro User');
                updateProFeaturesVisibility('Pro');
                
                console.log("🧪 DEV MODE: Pro status set to Pro");
            } catch (error) {
                console.error("Error setting Pro status:", error);
                alert("Error setting Pro status");
            }
        });
    }

    // Show development mode section if in dev mode
    const devModeSection = document.getElementById('devModeSection');
    if (devModeSection) {
        devModeSection.style.display = 'block';
    }
}

function loadSettings() {
    chrome.storage.sync.get([
        'emailAlerts',
        'chromeNotifications',
        'autoRefresh',
        'refreshInterval',
        'workingHoursEnabled',
        'workStartTime',
        'workEndTime',
        'darkMode',
        'userPlan',
        'userEmail'
    ], function(result) {
        // Set toggle states
        const emailAlertsToggle = document.getElementById('emailAlertsToggle');
        const chromeNotificationsToggle = document.getElementById('chromeNotificationsToggle');
        const autoRefreshToggle = document.getElementById('autoRefreshToggle');
        const workingHoursToggle = document.getElementById('workingHoursToggle');
        const darkModeToggle = document.getElementById('darkModeToggle');
        
        if (emailAlertsToggle) {
            emailAlertsToggle.checked = result.emailAlerts || false;
        }
        
        if (chromeNotificationsToggle) {
            chromeNotificationsToggle.checked = result.chromeNotifications !== false; // Default to true
        }
        
        if (autoRefreshToggle) {
            autoRefreshToggle.checked = result.autoRefresh || false;
        }
        
        if (workingHoursToggle) {
            workingHoursToggle.checked = result.workingHoursEnabled || false;
        }
        
        if (darkModeToggle) {
            darkModeToggle.checked = result.darkMode || false;
        }
        
        // Set input values
        const refreshInterval = document.getElementById('refreshInterval');
        const workStartTime = document.getElementById('workStartTime');
        const workEndTime = document.getElementById('workEndTime');
        
        if (refreshInterval) {
            refreshInterval.value = result.refreshInterval || 60;
        }
        
        if (workStartTime) {
            workStartTime.value = result.workStartTime || '09:00';
        }
        
        if (workEndTime) {
            workEndTime.value = result.workEndTime || '17:00';
        }
        
        // Account info is handled by checkAuthState() which reads from local storage
        // Don't override with sync storage data here
    });
}

function saveSettings() {
    const settings = {
        emailAlerts: document.getElementById('emailAlertsToggle')?.checked || false,
        chromeNotifications: document.getElementById('chromeNotificationsToggle')?.checked || false,
        autoRefresh: document.getElementById('autoRefreshToggle')?.checked || false,
        refreshInterval: parseInt(document.getElementById('refreshInterval')?.value) || 60,
        workingHoursEnabled: document.getElementById('workingHoursToggle')?.checked || false,
        workStartTime: document.getElementById('workStartTime')?.value || '09:00',
        workEndTime: document.getElementById('workEndTime')?.value || '17:00',
        darkMode: document.getElementById('darkModeToggle')?.checked || false
    };
    
    chrome.storage.sync.set(settings, function() {
        console.log('Settings saved:', settings);
        
        // Show save confirmation
        showSaveConfirmation();
        
        // Apply dark mode if changed
        if (settings.darkMode !== undefined) {
            applyDarkMode(settings.darkMode);
        }
    });
}

function updateAccountInfo(plan, email) {
    const currentPlan = document.getElementById('currentPlan');
    const accountStatus = document.getElementById('accountStatus');
    
    if (currentPlan) {
        currentPlan.textContent = plan || 'Free';
        currentPlan.className = `setting-value ${plan === 'Pro' ? 'pro' : 'free'}`;
    }
    
    if (accountStatus) {
        if (email) {
            accountStatus.textContent = email;
        } else {
            accountStatus.textContent = 'Not signed in';
        }
    }
}

function updateProFeaturesVisibility(plan) {
    const proOnlyElements = document.querySelectorAll('.pro-only');
    const isPro = plan === 'Pro';
    
    // Handle elements inside .pro-only sections
    proOnlyElements.forEach(element => {
        if (isPro) {
            element.classList.add('available');
            element.style.opacity = '1';
            
            // Enable all Pro-only inputs
            const inputs = element.querySelectorAll('input');
            inputs.forEach(input => {
                if (input.id === 'workingHoursToggle' || 
                    input.id === 'workStartTime' || 
                    input.id === 'workEndTime') {
                    input.disabled = false;
                }
            });
        } else {
            element.classList.remove('available');
            element.style.opacity = '0.6';
            
            // Disable all Pro-only inputs
            const inputs = element.querySelectorAll('input');
            inputs.forEach(input => {
                if (input.id === 'workingHoursToggle' || 
                    input.id === 'workStartTime' || 
                    input.id === 'workEndTime') {
                    input.disabled = true;
                }
            });
        }
    });
    
    // Handle Pro-only inputs that are not inside .pro-only sections
    const emailAlertsToggle = document.getElementById('emailAlertsToggle');
    if (emailAlertsToggle) {
        emailAlertsToggle.disabled = !isPro;
    }
}

function handleUpgrade() {
    // Open upgrade modal
    const upgradeModal = document.getElementById('upgradeModal');
    if (upgradeModal) {
        upgradeModal.style.display = 'block';
    }
}


function showHelpModal() {
    const helpModal = document.getElementById('helpModal');
    if (helpModal) {
        helpModal.style.display = 'block';
    }
}

function hideHelpModal() {
    const helpModal = document.getElementById('helpModal');
    if (helpModal) {
        helpModal.style.display = 'none';
    }
}

function closeOptionsPage() {
    window.close();
}

function showSaveConfirmation() {
    // Create a temporary notification
    const notification = document.createElement('div');
    notification.textContent = 'Settings saved!';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #10b981;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

function applyDarkMode(enabled) {
    if (enabled) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .setting-value.pro {
        color: #f59e0b;
        font-weight: 600;
    }
    
    .setting-value.free {
        color: #64748b;
    }
`;
document.head.appendChild(style); 