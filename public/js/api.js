/**
 * api.js — Shared API client & auth utilities
 * Loaded first on every page before any page-specific scripts.
 *
 * Exports (attached to window for script-tag interop):
 *   window.API           — fetch wrapper + constants
 *   window.Auth          — token & JWT helpers
 *   window.Toast         — toast notification system
 *   window.Fmt           — formatting helpers (salary, date, badge)
 */

/* ─────────────────────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────────────────────── */
const API_BASE = '/api/v1'; // Proxies to the Express server on same origin

/* ─────────────────────────────────────────────────────────────
   AUTH HELPERS  (window.Auth)
───────────────────────────────────────────────────────────── */
const Auth = (() => {
  const TOKEN_KEY = 'nexus_token';

  /** Store the JWT in localStorage */
  const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);

  /** Retrieve the JWT (or null) */
  const getToken = () => localStorage.getItem(TOKEN_KEY);

  /** Remove the JWT (logout) */
  const clearToken = () => localStorage.removeItem(TOKEN_KEY);

  /**
   * Decode the JWT payload WITHOUT verifying the signature.
   * Used client-side only to read non-sensitive claims (role, exp).
   * @returns {object|null}
   */
  const decodeToken = (token) => {
    try {
      const base64Url = token.split('.')[1];
      const base64    = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(base64));
    } catch {
      return null;
    }
  };

  /** Returns the role string ('seeker' | 'recruiter') or null */
  const getRole = () => {
    const token = getToken();
    if (!token) return null;
    return decodeToken(token)?.role ?? null;
  };

  /** Returns the user's MongoDB ID (sub claim) or null */
  const getUserId = () => {
    const token = getToken();
    if (!token) return null;
    return decodeToken(token)?.sub ?? null;
  };

  /** True if a non-expired token is present */
  const isAuthenticated = () => {
    const token = getToken();
    if (!token) return false;
    const payload = decodeToken(token);
    if (!payload?.exp) return false;
    return (Date.now() / 1000) < payload.exp;
  };

  /**
   * Redirect to /login.html if the user is not authenticated.
   * Call this at the top of any protected page script.
   */
  const requireAuth = () => {
    if (!isAuthenticated()) {
      window.location.replace('/login.html');
      return false;
    }
    return true;
  };

  /**
   * Redirect authenticated users away from auth pages (login/register).
   * Call this at the top of login.js / register.js.
   */
  const requireGuest = () => {
    if (isAuthenticated()) {
      window.location.replace('/dashboard.html');
      return false;
    }
    return true;
  };

  /** Log out: clear token and go to home */
  const logout = () => {
    clearToken();
    window.location.replace('/login.html');
  };

  return { setToken, getToken, clearToken, decodeToken, getRole, getUserId, isAuthenticated, requireAuth, requireGuest, logout };
})();

/* ─────────────────────────────────────────────────────────────
   API FETCH WRAPPER  (window.API)
───────────────────────────────────────────────────────────── */
const API = (() => {
  /**
   * Core fetch wrapper.
   * - Automatically attaches the Bearer token header.
   * - Serialises the body to JSON.
   * - Throws an Error whose .message is the API's error string.
   *
   * @param {string} endpoint  — e.g. '/jobs' or '/auth/login'
   * @param {object} options   — standard fetch options (method, body, etc.)
   * @returns {Promise<object>} — parsed JSON response body
   */
  const request = async (endpoint, options = {}) => {
    const token = Auth.getToken();

    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    };

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await res.json();

    if (!res.ok) {
      // Propagate the API's own error message so catch blocks can alert() it
      const err = new Error(data.message || `Request failed (HTTP ${res.status})`);
      err.status = res.status;
      err.data   = data;
      throw err;
    }

    return data;
  };

  const get    = (endpoint, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`${endpoint}${qs ? '?' + qs : ''}`);
  };
  const post   = (endpoint, body)   => request(endpoint, { method: 'POST',   body });
  const patch  = (endpoint, body)   => request(endpoint, { method: 'PATCH',  body });
  const del    = (endpoint)         => request(endpoint, { method: 'DELETE' });

  return { request, get, post, patch, delete: del };
})();

/* ─────────────────────────────────────────────────────────────
   TOAST SYSTEM  (window.Toast)
   In addition to the required alert() calls in catch blocks,
   toasts provide non-blocking feedback for success messages.
───────────────────────────────────────────────────────────── */
const Toast = (() => {
  const ICONS = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const DURATION = 4000;

  const show = (message, type = 'info') => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <span class="toast__icon" aria-hidden="true">${ICONS[type] ?? 'ℹ️'}</span>
      <span class="toast__message">${message}</span>
      <button class="toast__close" aria-label="Dismiss notification">✕</button>
    `;

    const remove = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(24px)';
      toast.style.transition = 'opacity 0.2s, transform 0.2s';
      setTimeout(() => toast.remove(), 200);
    };

    toast.querySelector('.toast__close').addEventListener('click', remove);
    container.appendChild(toast);
    setTimeout(remove, DURATION);
  };

  return {
    success: (msg) => show(msg, 'success'),
    error:   (msg) => show(msg, 'error'),
    info:    (msg) => show(msg, 'info'),
    warning: (msg) => show(msg, 'warning'),
  };
})();

/* ─────────────────────────────────────────────────────────────
   FORMATTING HELPERS  (window.Fmt)
───────────────────────────────────────────────────────────── */
const Fmt = (() => {

  /** Format a salary object into a display string */
  const salary = (salaryObj) => {
    if (!salaryObj || (!salaryObj.min && !salaryObj.max)) return 'Salary not disclosed';
    const { min, max, currency = 'USD', period = 'yearly' } = salaryObj;
    const fmt = (n) => `${currency} ${Number(n).toLocaleString()}`;
    if (min && max) return `${fmt(min)} – ${fmt(max)} / ${period}`;
    if (min) return `From ${fmt(min)} / ${period}`;
    return `Up to ${fmt(max)} / ${period}`;
  };

  /** Format an ISO date string to a human-readable relative or absolute date */
  const date = (isoStr) => {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  /** Map a job status string to a CSS badge class */
  const statusBadge = (status) => {
    const map = {
      open:        'badge--green',
      closed:      'badge--red',
      paused:      'badge--amber',
      pending:     'badge--amber',
      reviewed:    'badge--blue',
      shortlisted: 'badge--green',
      accepted:    'badge--green',
      rejected:    'badge--red',
      'full-time': 'badge--blue',
      'part-time': 'badge--amber',
      contract:    'badge--gray',
      internship:  'badge--gray',
      freelance:   'badge--gray',
      remote:      'badge--green',
      hybrid:      'badge--blue',
      'on-site':   'badge--gray',
    };
    return map[status] ?? 'badge--gray';
  };

  /** Capitalise first letter, replace hyphens with spaces */
  const label = (str) =>
    str ? str.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '';

  /** Get initials from a name string e.g. "Jane Doe" → "JD" */
  const initials = (name = '') =>
    name.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 2);

  return { salary, date, statusBadge, label, initials };
})();

/* ─────────────────────────────────────────────────────────────
   NAVBAR AUTH STATE
   Called by every page to sync the navbar with the login state.
───────────────────────────────────────────────────────────── */
const updateNavAuthState = () => {
  const guestEl  = document.getElementById('nav-guest-actions');
  const authEl   = document.getElementById('nav-auth-actions');
  const usernameEl = document.getElementById('nav-username');
  const avatarEl   = document.getElementById('nav-avatar');

  if (!guestEl || !authEl) return;

  if (Auth.isAuthenticated()) {
    guestEl.style.display = 'none';
    authEl.style.display  = 'flex';

    // Try to populate from the stored user data
    const stored = JSON.parse(localStorage.getItem('nexus_user') || 'null');
    if (stored) {
      if (usernameEl) usernameEl.textContent = `${stored.firstName} ${stored.lastName[0]}.`;
      if (avatarEl)   avatarEl.textContent   = Fmt.initials(`${stored.firstName} ${stored.lastName}`);
    }
  } else {
    guestEl.style.display = 'flex';
    authEl.style.display  = 'none';
  }
};

// Run on every page
document.addEventListener('DOMContentLoaded', () => {
  updateNavAuthState();

  // Mobile hamburger toggle (index.html navbar)
  const hamburger = document.getElementById('hamburger-btn');
  const mainNav   = document.getElementById('main-nav');
  if (hamburger && mainNav) {
    hamburger.addEventListener('click', () => {
      const isOpen = mainNav.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', String(isOpen));
    });
  }
});

// Expose to all scripts
window.API   = API;
window.Auth  = Auth;
window.Toast = Toast;
window.Fmt   = Fmt;
window.updateNavAuthState = updateNavAuthState;
