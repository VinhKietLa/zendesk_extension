// Content script for adding "Copy Ticket ID" button to Zendesk ticket pages

console.log("🎫 Copy Ticket ID content script loaded");



function getTicketIdFromUrl() {
  const url = window.location.href;
  console.log("🔍 Checking URL:", url);
  const match = url.match(/\/tickets\/(\d+)/);
  const ticketId = match ? match[1] : null;
  console.log("🎫 Ticket ID from URL:", ticketId);
  return ticketId;
}

function getTicketIdFromDOM() {
  console.log("🔍 Checking DOM for ticket ID...");
  const selectors = [
    '[data-testid="ticket-id"]',
    '.ticket-id',
    '[data-garden-id="typography.text"]',
    '.ticket-header h1',
    '.ticket-title'
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      console.log("🔍 Found element with selector:", selector, element.textContent);
      const match = element.textContent.match(/(?:Ticket|#)?(\d+)/i);
      if (match) {
        console.log("🎫 Ticket ID from DOM:", match[1]);
        return match[1];
      }
    }
  }
  console.log("❌ No ticket ID found in DOM");
  return null;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    return success;
  }
}

function showToast(message, type = 'success') {
  const existingToast = document.querySelector('.agent-hero-toast');
  if (existingToast) existingToast.remove();
  const toast = document.createElement('div');
  toast.className = `agent-hero-toast agent-hero-toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#4CAF50' : '#f44336'};
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    animation: slideIn 0.3s ease-out;
  `;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
}

function injectCopyButtonWithRetry(retries = 10, delay = 500) {
  console.log("🔧 Attempting to inject copy button (retry count:", 11 - retries, ")...");
  if (document.querySelector('.agent-hero-copy-btn')) {
    console.log("✅ Copy button already exists");
    return;
  }
  const ticketId = getTicketIdFromUrl() || getTicketIdFromDOM();
  if (!ticketId) {
    console.log("❌ No ticket ID found, cannot inject button");
    return;
  }
  console.log("🎫 Found ticket ID:", ticketId);
  // Flexible nav selector
  const nav = document.querySelector('nav.btn-group[aria-label*="Ticket page location"]');
  if (!nav) {
    if (retries > 0) {
      setTimeout(() => injectCopyButtonWithRetry(retries - 1, delay), delay);
    } else {
      console.log("❌ Nav not found after retries");
    }
    return;
  }
  const ticketSpan = nav.querySelector('span[data-test-id="tabs-section-nav-item-ticket"]');
  if (!ticketSpan) {
    if (retries > 0) {
      setTimeout(() => injectCopyButtonWithRetry(retries - 1, delay), delay);
    } else {
      console.log("❌ Ticket nav span not found after retries");
    }
    return;
  }
  const button = document.createElement('button');
  button.className = 'agent-hero-copy-btn';
  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
    </svg>
    Copy Ticket ID
  `;
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #03363d;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
    margin-left: 10px;
  `;
  button.addEventListener('mouseenter', () => { button.style.background = '#0a4a52'; });
  button.addEventListener('mouseleave', () => { button.style.background = '#03363d'; });
  button.addEventListener('click', async () => {
    try {
      const success = await copyToClipboard(ticketId);
      if (success) {
        showToast(`Ticket ID ${ticketId} copied to clipboard!`, 'success');
        button.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
          Copied!
        `;
        setTimeout(() => {
          button.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
            </svg>
            Copy Ticket ID
          `;
        }, 2000);
      } else {
        showToast('Failed to copy ticket ID', 'error');
      }
    } catch (error) {
      console.error('Error copying ticket ID:', error);
      showToast('Failed to copy ticket ID', 'error');
    }
  });
  ticketSpan.appendChild(button);
  console.log("✅ Copy Ticket ID button injected into nav");
}

function init() {
  console.log("🚀 Initializing Copy Ticket ID script...");
  injectCopyButtonWithRetry();
  let currentUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      console.log("🔄 URL changed, re-injecting button...");
      setTimeout(() => injectCopyButtonWithRetry(), 1000);
    }
  });
  observer.observe(document, { subtree: true, childList: true });
}
init(); 