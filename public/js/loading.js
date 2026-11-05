/**
 * Loading State Utilities
 * Manages loading states for buttons and async operations
 */

/**
 * Set a button to loading state
 * @param {HTMLButtonElement} button - The button element
 * @param {string} loadingText - Text to show while loading (default: 'Loading...')
 * @returns {Function} - Function to restore original state
 */
export function setButtonLoading(button, loadingText = 'Loading...') {
    if (!button) return () => {};
    
    const originalText = button.textContent;
    const originalDisabled = button.disabled;
    
    button.disabled = true;
    button.classList.add('loading');
    button.dataset.originalText = originalText;
    button.innerHTML = `
        <span class="btn-spinner"></span>
        <span>${loadingText}</span>
    `;
    
    // Return restore function
    return () => {
        button.disabled = originalDisabled;
        button.classList.remove('loading');
        button.textContent = originalText;
    };
}

/**
 * Wrap an async function with loading state management
 * @param {HTMLButtonElement} button - The button element
 * @param {Function} asyncFn - Async function to execute
 * @param {Object} options - Options
 * @param {string} options.loadingText - Text to show while loading
 * @param {string} options.successText - Text to show briefly on success
 * @returns {Promise<any>} - Result of the async function
 */
export async function withLoadingState(button, asyncFn, options = {}) {
    const { loadingText = 'Saving...', successText } = options;
    const restore = setButtonLoading(button, loadingText);
    
    try {
        const result = await asyncFn();
        
        // Brief success state
        if (successText && button) {
            button.classList.remove('loading');
            button.classList.add('success');
            button.innerHTML = `
                <span class="btn-check">✓</span>
                <span>${successText}</span>
            `;
            
            await new Promise(r => setTimeout(r, 1000));
        }
        
        return result;
    } finally {
        restore();
    }
}



// ------------------------------------------------------------------ Page spinner

/*
 * While a page fetches its data, a spinner covers the page and the finished page appears in one go,
 * instead of showing placeholders that fill in bit by bit. The cover fades in after a short delay (see
 * .page-spinner in styles.css), so data that arrives quickly never flashes a spinner.
 */
let spinnerUsers = 0;

function pageSpinnerEl() {
    let spinner = document.getElementById('pageSpinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'pageSpinner';
        spinner.className = 'page-spinner';
        spinner.setAttribute('role', 'status');
        spinner.setAttribute('aria-label', 'Loading');
        spinner.innerHTML = '<div class="page-spinner-wheel"></div>';
        document.body.appendChild(spinner);
    }
    return spinner;
}

export function showPageSpinner() {
    spinnerUsers++;
    pageSpinnerEl().classList.add('visible');
}

export function hidePageSpinner() {
    spinnerUsers = Math.max(0, spinnerUsers - 1);
    if (spinnerUsers === 0) document.getElementById('pageSpinner')?.classList.remove('visible');
}

/** Run an async task with the page covered by the spinner until it finishes (or fails) */
export async function withPageSpinner(task) {
    showPageSpinner();
    try {
        return await task();
    } finally {
        hidePageSpinner();
    }
}

// floor-plan.js is a plain script, not a module
window.withPageSpinner = withPageSpinner;
