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
    const soundAlertsToggle = document.getElementById('soundAlertsToggle');
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    const workingHoursToggle = document.getElementById('workingHoursToggle');
    const darkModeToggle = document.getElementById('darkModeToggle');
    
    // Input fields
    const refreshInterval = document.getElementById('refreshInterval');
    const workStartTime = document.getElementById('workStartTime');
    const workEndTime = document.getElementById('workEndTime');
    
    // Buttons
    const upgradeBtn = document.getElementById('upgradeBtn');
    const signInBtn = document.getElementById('signInBtn');
    
    // Add event listeners for toggles
    if (emailAlertsToggle) {
        emailAlertsToggle.addEventListener('change', saveSettings);
    }
    
    if (chromeNotificationsToggle) {
        chromeNotificationsToggle.addEventListener('change', saveSettings);
    }
    
    if (soundAlertsToggle) {
        soundAlertsToggle.addEventListener('change', saveSettings);
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
    
    if (signInBtn) {
        signInBtn.addEventListener('click', handleSignIn);
    }
    
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
}

function loadSettings() {
    chrome.storage.sync.get([
        'emailAlerts',
        'chromeNotifications',
        'soundAlerts',
        'autoRefresh',
        'refreshInterval',
        'workingHours',
        'workStartTime',
        'workEndTime',
        'darkMode',
        'userPlan',
        'userEmail'
    ], function(result) {
        // Set toggle states
        const emailAlertsToggle = document.getElementById('emailAlertsToggle');
        const chromeNotificationsToggle = document.getElementById('chromeNotificationsToggle');
        const soundAlertsToggle = document.getElementById('soundAlertsToggle');
        const autoRefreshToggle = document.getElementById('autoRefreshToggle');
        const workingHoursToggle = document.getElementById('workingHoursToggle');
        const darkModeToggle = document.getElementById('darkModeToggle');
        
        if (emailAlertsToggle) {
            emailAlertsToggle.checked = result.emailAlerts || false;
        }
        
        if (chromeNotificationsToggle) {
            chromeNotificationsToggle.checked = result.chromeNotifications !== false; // Default to true
        }
        
        if (soundAlertsToggle) {
            soundAlertsToggle.checked = result.soundAlerts !== false; // Default to true
        }
        
        if (autoRefreshToggle) {
            autoRefreshToggle.checked = result.autoRefresh || false;
        }
        
        if (workingHoursToggle) {
            workingHoursToggle.checked = result.workingHours || false;
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
        
        // Update account info
        updateAccountInfo(result.userPlan, result.userEmail);
        
        // Update Pro features visibility
        updateProFeaturesVisibility(result.userPlan);
    });
}

function saveSettings() {
    const settings = {
        emailAlerts: document.getElementById('emailAlertsToggle')?.checked || false,
        chromeNotifications: document.getElementById('chromeNotificationsToggle')?.checked || false,
        soundAlerts: document.getElementById('soundAlertsToggle')?.checked || false,
        autoRefresh: document.getElementById('autoRefreshToggle')?.checked || false,
        refreshInterval: parseInt(document.getElementById('refreshInterval')?.value) || 60,
        workingHours: document.getElementById('workingHoursToggle')?.checked || false,
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
    
    proOnlyElements.forEach(element => {
        if (isPro) {
            element.classList.add('available');
            element.style.opacity = '1';
            
            // Enable Pro-only inputs
            const inputs = element.querySelectorAll('input[disabled]');
            inputs.forEach(input => {
                input.disabled = false;
            });
        } else {
            element.classList.remove('available');
            element.style.opacity = '0.6';
            
            // Disable Pro-only inputs
            const inputs = element.querySelectorAll('input:not([disabled])');
            inputs.forEach(input => {
                if (input.id === 'workingHoursToggle' || 
                    input.id === 'workStartTime' || 
                    input.id === 'workEndTime' ||
                    input.id === 'emailAlertsToggle') {
                    input.disabled = true;
                }
            });
        }
    });
}

function handleUpgrade() {
    // Open upgrade modal or redirect to payment page
    chrome.tabs.create({
        url: 'https://github.com/VinhKietLa/zendesk_extension#upgrade'
    });
}

function handleSignIn() {
    // Trigger sign in process
    chrome.runtime.sendMessage({ action: 'signIn' }, function(response) {
        if (response && response.success) {
            // Reload settings to update account info
            loadSettings();
        }
    });
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