// Dropdown menu functionality
document.addEventListener('DOMContentLoaded', function() {
    const menuBtn = document.getElementById('menuBtn');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const helpBtn = document.getElementById('helpBtn');
    const settingsBtn = document.getElementById('settingsBtn');

    // Toggle dropdown menu
    if (menuBtn && dropdownMenu) {
        menuBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            dropdownMenu.classList.toggle('open');
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (dropdownMenu && !dropdownMenu.contains(e.target) && !menuBtn.contains(e.target)) {
            dropdownMenu.classList.remove('open');
        }
    });

    // Help button - open GitHub README
    if (helpBtn) {
        helpBtn.addEventListener('click', function() {
            chrome.tabs.create({
                url: 'https://github.com/VinhKietLa/zendesk_extension#readme'
            });
        });
    }

    // Settings button - open options page
    if (settingsBtn) {
        settingsBtn.addEventListener('click', function() {
            chrome.runtime.openOptionsPage();
        });
    }
}); 