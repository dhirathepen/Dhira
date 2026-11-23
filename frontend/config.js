/**
 * Dhira — API location.
 *
 * The site and the API are served by the same Node process, so the default
 * relative path works everywhere. If you host this frontend separately
 * (for example on GitHub Pages), set the full API URL here and add the
 * frontend origin to ALLOWED_ORIGINS on the backend:
 *
 *   window.DHIRA_CONFIG = { API_BASE: 'https://your-api.example.com/api' };
 */
window.DHIRA_CONFIG = {
  API_BASE: '/api',
};
