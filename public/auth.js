// Azure AD Authentication using MSAL.js

// Utility function to escape HTML (XSS prevention)
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Config will be loaded from server
let msalConfig = null;

// Scopes for login - includes OpenID scopes for ID token and Graph API scopes
const loginRequest = {
    scopes: ['openid', 'profile', 'email', 'User.Read', 'User.Read.All', 'Directory.Read.All']
};

const graphConfig = {
    graphMeEndpoint: 'https://graph.microsoft.com/v1.0/me',
    graphPhotoEndpoint: 'https://graph.microsoft.com/v1.0/me/photo/$value',
    graphUsersEndpoint: 'https://graph.microsoft.com/v1.0/users',
    graphDirectReportsEndpoint: 'https://graph.microsoft.com/v1.0/users/{id}/directReports'
};

// MSAL instance
let msalInstance = null;
let currentAccount = null;
let authConfigured = false;

// Fetch auth config from server
async function fetchAuthConfig() {
    try {
        const response = await fetch('/api/auth/config');
        const config = await response.json();
        
        if (!config.configured) {
            console.warn('Azure AD not configured on server');
            return null;
        }
        
        return {
            auth: {
                clientId: config.clientId,
                authority: config.authority,
                redirectUri: config.redirectUri,
                postLogoutRedirectUri: window.location.origin,
                navigateToLoginRequestUrl: true
            },
            cache: {
                cacheLocation: 'localStorage', // Use localStorage for better persistence
                storeAuthStateInCookie: true   // Fallback for older browsers
            },
            system: {
                loggerOptions: {
                    logLevel: msal.LogLevel.Warning
                }
            }
        };
    } catch (error) {
        console.error('Failed to fetch auth config:', error);
        return null;
    }
}

// Initialize MSAL
async function initializeMsal() {
    // Fetch config from server
    msalConfig = await fetchAuthConfig();
    
    if (!msalConfig) {
        // Azure AD not configured - skip auth and go straight to app
        console.log('Azure AD not configured, skipping authentication');
        authConfigured = false;
        hideLoginUI();
        if (typeof initApp === 'function') {
            initApp();
        }
        return;
    }
    
    authConfigured = true;
    
    try {
        msalInstance = new msal.PublicClientApplication(msalConfig);
        
        // Wait for MSAL to initialize (required for redirect handling)
        await msalInstance.initialize();
        
        // Handle redirect response - this must be awaited
        const response = await msalInstance.handleRedirectPromise();
        await handleResponse(response);
    } catch (error) {
        console.error('MSAL initialization or redirect error:', error);
        // Show login UI on error so user can try again
        showLoginUI();
    }
}

// Handle auth response
async function handleResponse(response) {
    if (response) {
        currentAccount = response.account;
        await onUserAuthenticated(currentAccount);
    } else {
        // Check if user is already signed in
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
            currentAccount = accounts[0];
            await onUserAuthenticated(currentAccount);
        } else {
            // Not logged in - show login UI
            showLoginUI();
        }
    }
}

// Sign in - use redirect flow for better reliability
async function signIn() {
    if (!msalInstance) {
        console.error('MSAL not initialized');
        return;
    }
    
    try {
        // Use redirect flow - more reliable than popup
        await msalInstance.loginRedirect(loginRequest);
    } catch (error) {
        console.error('Sign in error:', error);
        if (typeof showToast === 'function') {
            showToast('Sign in failed: ' + error.message, 'error');
        }
    }
}

// Sign out
function signOut() {
    if (!msalInstance) return;
    
    const logoutRequest = {
        account: currentAccount,
        postLogoutRedirectUri: msalConfig.auth.postLogoutRedirectUri
    };
    
    msalInstance.logoutRedirect(logoutRequest);
}

// Get access token silently (for Microsoft Graph API calls)
async function getAccessToken() {
    if (!msalInstance || !currentAccount) return null;
    
    const tokenRequest = {
        scopes: loginRequest.scopes,
        account: currentAccount
    };
    
    try {
        const response = await msalInstance.acquireTokenSilent(tokenRequest);
        return response.accessToken;
    } catch (error) {
        if (error instanceof msal.InteractionRequiredAuthError) {
            // Token expired, need to re-authenticate
            try {
                const response = await msalInstance.acquireTokenPopup(tokenRequest);
                return response.accessToken;
            } catch (popupError) {
                console.error('Token acquisition failed:', popupError);
                signIn();
                return null;
            }
        }
        console.error('Token acquisition error:', error);
        return null;
    }
}

// Get ID token for backend API calls (has app client ID as audience)
/**
 * Like getIdToken, but silent: it never opens a popup or redirects. Used for background API calls and
 * the websocket, where an unexpected popup would be worse than simply sending no token.
 * Resolves with the ID token, or null when there is no signed-in account or the session has expired.
 */
async function getIdTokenQuietly() {
    if (!msalInstance || !currentAccount) return null;
    try {
        const response = await msalInstance.acquireTokenSilent({
            scopes: ['openid', 'profile', 'email'],
            account: currentAccount
        });
        return response.idToken || null;
    } catch (error) {
        return null;
    }
}

async function getIdToken() {
    if (!msalInstance) {
        console.error('getIdToken: MSAL instance not initialized');
        return null;
    }
    
    if (!currentAccount) {
        console.error('getIdToken: No current account');
        return null;
    }
    
    // Request with openid scope to get ID token
    // The ID token will have the client ID as the audience automatically
    const tokenRequest = {
        scopes: ['openid', 'profile', 'email'],
        account: currentAccount
    };
    
    try {
        console.log('Attempting to acquire token silently...');
        const response = await msalInstance.acquireTokenSilent(tokenRequest);
        console.log('Token acquired silently, ID token present:', !!response.idToken);
        return response.idToken;
    } catch (error) {
        console.warn('Silent token acquisition failed:', error.errorCode || error.message);
        
        if (error instanceof msal.InteractionRequiredAuthError) {
            console.log('Interaction required, trying popup...');
            try {
                const response = await msalInstance.acquireTokenPopup(tokenRequest);
                console.log('Token acquired via popup, ID token present:', !!response.idToken);
                return response.idToken;
            } catch (popupError) {
                console.error('ID token acquisition via popup failed:', popupError.errorCode || popupError.message);
                // Don't automatically sign in - let the user retry
                return null;
            }
        }
        console.error('ID token acquisition error:', error.errorCode || error.message);
        return null;
    }
}

// Fetch user profile from Microsoft Graph
async function fetchUserProfile() {
    const token = await getAccessToken();
    if (!token) return null;
    
    try {
        const response = await fetch(graphConfig.graphMeEndpoint, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('Failed to fetch user profile:', error);
    }
    return null;
}

// Fetch user photo from Microsoft Graph
async function fetchUserPhoto() {
    const token = await getAccessToken();
    if (!token) return null;
    
    try {
        const response = await fetch(graphConfig.graphPhotoEndpoint, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const blob = await response.blob();
            // Convert to base64 data URL so it persists after reload
            return await blobToDataUrl(blob);
        }
    } catch (error) {
        // Photo not available is common, don't log as error
    }
    return null;
}

// Convert blob to base64 data URL
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Fetch all unique job titles from Azure AD
async function fetchAllJobTitles() {
    const token = await getAccessToken();
    if (!token) return [];
    
    try {
        const response = await fetch(
            `${graphConfig.graphUsersEndpoint}?$select=jobTitle&$top=999`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'ConsistencyLevel': 'eventual'
                }
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            const titles = new Set();
            data.value.forEach(user => {
                if (user.jobTitle) {
                    titles.add(user.jobTitle);
                }
            });
            return Array.from(titles).sort();
        }
    } catch (error) {
        console.error('Failed to fetch job titles:', error);
    }
    return [];
}

// Fetch users by job titles
async function fetchUsersByJobTitles(jobTitles) {
    const token = await getAccessToken();
    if (!token || !jobTitles.length) return [];
    
    try {
        // Build filter for multiple job titles
        const filter = jobTitles.map(title => `jobTitle eq '${title}'`).join(' or ');
        const response = await fetch(
            `${graphConfig.graphUsersEndpoint}?$filter=${encodeURIComponent(filter)}&$select=id,displayName,jobTitle,mail,userPrincipalName&$top=999`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'ConsistencyLevel': 'eventual'
                }
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            return data.value;
        }
    } catch (error) {
        console.error('Failed to fetch users by job titles:', error);
    }
    return [];
}

// Fetch user's photo by ID
async function fetchUserPhotoById(userId) {
    const token = await getAccessToken();
    if (!token) return null;
    
    try {
        const response = await fetch(
            `${graphConfig.graphUsersEndpoint}/${userId}/photo/$value`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        
        if (response.ok) {
            const blob = await response.blob();
            // Convert to base64 data URL so it persists after reload
            return await blobToDataUrl(blob);
        }
    } catch (error) {
        // Photo not available is common
    }
    return null;
}

// Fetch direct reports count for a user
async function fetchDirectReportsCount(userId) {
    const token = await getAccessToken();
    if (!token) return 0;
    
    try {
        // Fetch all direct reports (we need to count them)
        const response = await fetch(
            `${graphConfig.graphUsersEndpoint}/${userId}/directReports?$select=id`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'ConsistencyLevel': 'eventual'
                }
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            return data.value?.length || 0;
        }
    } catch (error) {
        console.error('Failed to fetch direct reports:', error);
    }
    return 0;
}

// Fetch direct reports for a user (full details)
async function fetchDirectReports(userId) {
    const token = await getAccessToken();
    if (!token) return [];
    
    try {
        const response = await fetch(
            `${graphConfig.graphUsersEndpoint}/${userId}/directReports?$select=id,displayName,jobTitle,mail`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            return data.value || [];
        }
    } catch (error) {
        console.error('Failed to fetch direct reports:', error);
    }
    return [];
}

// Called when user is authenticated
async function onUserAuthenticated(account) {
    console.log('User authenticated:', account.username);
    
    // Fetch additional profile info
    const profile = await fetchUserProfile();
    const photo = await fetchUserPhoto();
    
    const user = {
        id: account.localAccountId,
        email: account.username,
        name: account.name || profile?.displayName || account.username.split('@')[0],
        photo: photo,
        jobTitle: profile?.jobTitle,
        department: profile?.department
    };
    
    // Store user info globally and in localStorage for persistence
    window.currentUser = user;
    localStorage.setItem('employeeName', user.name);
    localStorage.setItem('employeeEmail', user.email);
    if (user.photo) {
        localStorage.setItem('employeePhoto', user.photo);
    }
    
    // Update UI
    showUserUI(user);
    hideLoginUI();
    
    // Initialize the app
    if (typeof initApp === 'function') {
        initApp();
    }
}

// Hide auth loading overlay
function hideAuthLoading() {
    const authLoading = document.getElementById('authLoadingOverlay');
    if (authLoading) {
        authLoading.classList.remove('visible');
    }
}

// Show login screen (only after auth check determines user needs to log in)
function showLoginUI() {
    hideAuthLoading();
    
    const loginOverlay = document.getElementById('loginOverlay');
    if (loginOverlay) {
        loginOverlay.classList.add('visible');
    }
    
    // Hide main app content
    const appContent = document.querySelector('.app');
    if (appContent) {
        appContent.style.display = 'none';
    }
}

// Hide login screen
function hideLoginUI() {
    hideAuthLoading();
    
    const loginOverlay = document.getElementById('loginOverlay');
    if (loginOverlay) {
        loginOverlay.classList.remove('visible');
    }
    
    // Show main app content
    const appContent = document.querySelector('.app');
    if (appContent) {
        appContent.style.display = '';
    }
}

// Show user info in header
function showUserUI(user) {
    const userInfo = document.getElementById('userInfo');
    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');
    
    if (userName) {
        userName.textContent = user.name;
    }
    
    if (userAvatar) {
        if (user.photo) {
            userAvatar.innerHTML = `<img src="${user.photo}" alt="${escapeHtml(user.name)}">`;
        } else {
            const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
            userAvatar.innerHTML = `<span>${escapeHtml(initials)}</span>`;
        }
    }
    
    if (userInfo) {
        userInfo.classList.add('visible');
    }
}

// Check if user is authenticated
function isAuthenticated() {
    return currentAccount !== null;
}

// Get current user
function getCurrentUser() {
    return window.currentUser || null;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Wait for MSAL library to load
    if (typeof msal !== 'undefined') {
        initializeMsal();
    } else {
        console.error('MSAL library not loaded');
    }
});

// Expose Azure AD functions globally for use by other modules
window.signIn = signIn;
window.signOut = signOut;
window.fetchAllJobTitles = fetchAllJobTitles;
window.fetchUsersByJobTitles = fetchUsersByJobTitles;
window.fetchUserPhotoById = fetchUserPhotoById;
window.fetchDirectReportsCount = fetchDirectReportsCount;
window.isAuthenticated = isAuthenticated;
window.getCurrentUser = getCurrentUser;
window.getAccessToken = getAccessToken;
window.getIdToken = getIdToken;
window.getIdTokenQuietly = getIdTokenQuietly;

// ============================================
// Send the signed-in user's token with every API call
// ============================================
// The server refuses API requests without a valid login (when REQUIRE_AUTH=true), reads included, so
// every call to our own /api has to carry the token. Wrapping fetch once covers all existing calls.
// A token problem never breaks a request: it goes out without the header and the server decides.
(function installApiAuthFetch() {
    const nativeFetch = window.fetch.bind(window);
    // Public on the server too: sign-in config and the QR check-in lookups (people scanning a desk sticker)
    const PUBLIC_API = [/^\/api\/auth\//, /^\/api\/checkin\//, /^\/api\/desk-bookings\/checkin\//];
    let signInPrompted = false;

    window.fetch = async function (input, init) {
        let url;
        try {
            url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
        } catch (error) {
            return nativeFetch(input, init);
        }

        const isOurApi = url.origin === window.location.origin
            && url.pathname.startsWith('/api/')
            && !PUBLIC_API.some(re => re.test(url.pathname));
        if (!isOurApi) return nativeFetch(input, init);

        const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
        if (!headers.has('Authorization')) {
            const token = await getIdTokenQuietly();
            if (token) headers.set('Authorization', 'Bearer ' + token);
        }

        const response = await nativeFetch(input, Object.assign({}, init, { headers }));

        // The session is gone (for example the refresh token expired): send the user back to sign in
        if (response.status === 401 && !signInPrompted) {
            try {
                const body = await response.clone().json();
                if (body && body.code === 'AUTH_REQUIRED') {
                    signInPrompted = true;
                    showLoginUI();
                }
            } catch (error) { /* not our JSON error: leave it alone */ }
        }
        return response;
    };
})();
