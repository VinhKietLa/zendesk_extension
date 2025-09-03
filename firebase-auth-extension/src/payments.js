// Chrome Web Store Payment Service
// Handles in-app purchases for Pro subscription

// Development mode flag - set to true for local testing
const DEV_MODE = true;

// Product ID for Pro subscription (you'll get this from Chrome Web Store)
const PRO_PRODUCT_ID = 'pro_subscription_monthly';

/**
 * Initialize the payment system
 */
export async function initializePayments() {
  try {
    // Check if payments are available
    if (!chrome.payments) {
      console.warn('Chrome payments API not available');
      return false;
    }
    
    console.log('✅ Payment system initialized');
    return true;
  } catch (error) {
    console.error('Error initializing payments:', error);
    return false;
  }
}

/**
 * Check if user has an active Pro subscription
 */
export async function checkProSubscription() {
  try {
    // In development mode, check local storage for test Pro status
    if (DEV_MODE) {
      const data = await chrome.storage.local.get('testProStatus');
      return data.testProStatus || false;
    }

    if (!chrome.payments) {
      return false;
    }

    const purchases = await chrome.payments.getPurchases();
    const proPurchase = purchases.find(purchase => 
      purchase.productId === PRO_PRODUCT_ID && 
      purchase.purchaseState === 'PURCHASED'
    );

    return !!proPurchase;
  } catch (error) {
    console.error('Error checking Pro subscription:', error);
    return false;
  }
}

/**
 * Purchase Pro subscription
 */
export async function purchasePro() {
  try {
    // In development mode, simulate successful purchase
    if (DEV_MODE) {
      console.log('🧪 DEV MODE: Simulating Pro purchase...');
      
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Set test Pro status
      await chrome.storage.local.set({ testProStatus: true });
      
      console.log('✅ DEV MODE: Pro purchase simulated successfully!');
      return {
        success: true,
        purchaseId: 'dev-test-purchase-' + Date.now(),
        message: 'Successfully upgraded to Pro! (Development Mode)'
      };
    }

    if (!chrome.payments) {
      throw new Error('Chrome payments API not available');
    }

    console.log('🛒 Starting Pro purchase...');

    // Create payment request
    const paymentRequest = {
      productId: PRO_PRODUCT_ID,
      type: 'subscription',
      title: 'Agent Hero Pro',
      description: 'Unlock all premium features including unlimited macros, cloud sync, and advanced reminders.',
      price: '£2.00',
      currency: 'GBP',
      billingPeriod: 'monthly'
    };

    // Request payment
    const result = await chrome.payments.purchase(paymentRequest);
    
    console.log('💰 Purchase result:', result);

    if (result.purchaseState === 'PURCHASED') {
      console.log('✅ Pro purchase successful!');
      return {
        success: true,
        purchaseId: result.purchaseId,
        message: 'Successfully upgraded to Pro!'
      };
    } else if (result.purchaseState === 'CANCELLED') {
      console.log('❌ Purchase cancelled by user');
      return {
        success: false,
        message: 'Purchase was cancelled'
      };
    } else {
      console.log('❌ Purchase failed:', result.purchaseState);
      return {
        success: false,
        message: 'Purchase failed. Please try again.'
      };
    }

  } catch (error) {
    console.error('Error purchasing Pro:', error);
    return {
      success: false,
      message: error.message || 'Payment error occurred'
    };
  }
}

/**
 * Restore purchases (for users who reinstalled extension)
 */
export async function restorePurchases() {
  try {
    // In development mode, check local storage for test Pro status
    if (DEV_MODE) {
      console.log('🧪 DEV MODE: Checking for test Pro status...');
      
      const data = await chrome.storage.local.get('testProStatus');
      const hasPro = data.testProStatus || false;
      
      if (hasPro) {
        console.log('✅ DEV MODE: Pro subscription restored from test data');
        return true;
      } else {
        console.log('ℹ️ DEV MODE: No test Pro subscription found');
        return false;
      }
    }

    if (!chrome.payments) {
      return false;
    }

    console.log('🔄 Restoring purchases...');
    
    const purchases = await chrome.payments.getPurchases();
    const proPurchase = purchases.find(purchase => 
      purchase.productId === PRO_PRODUCT_ID && 
      purchase.purchaseState === 'PURCHASED'
    );

    if (proPurchase) {
      console.log('✅ Pro subscription restored');
      return true;
    } else {
      console.log('ℹ️ No active Pro subscription found');
      return false;
    }

  } catch (error) {
    console.error('Error restoring purchases:', error);
    return false;
  }
}

/**
 * Get subscription status for display
 */
export async function getSubscriptionStatus() {
  try {
    const isPro = await checkProSubscription();
    
    if (isPro) {
      return {
        isPro: true,
        plan: 'Pro',
        status: 'Active',
        nextBilling: 'Monthly'
      };
    } else {
      return {
        isPro: false,
        plan: 'Free',
        status: 'Active',
        upgradeAvailable: true
      };
    }
  } catch (error) {
    console.error('Error getting subscription status:', error);
    return {
      isPro: false,
      plan: 'Free',
      status: 'Unknown',
      error: true
    };
  }
} 