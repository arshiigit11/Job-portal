/**
 * auth.js — Handles login.html and register.html
 *
 * Depends on: api.js (loaded first via <script>)
 *
 * Responsibilities:
 *  - Redirect already-authenticated users away from auth pages
 *  - Wire login form → POST /api/v1/auth/login → save token → redirect
 *  - Wire register form → POST /api/v1/auth/register → save token → redirect
 *  - Show/hide company field based on selected role
 *  - Password visibility toggles
 *  - Client-side validation before hitting the API
 *  - Password strength meter (register only)
 */

document.addEventListener('DOMContentLoaded', () => {

  // ── Guard: send authenticated users straight to dashboard ──────────────────
  if (!Auth.requireGuest()) return;

  // ── Route to the correct initialiser based on which page we're on ──────────
  if (document.getElementById('login-form'))    initLogin();
  if (document.getElementById('register-form')) initRegister();

});

/* ═══════════════════════════════════════════════════════════════
   LOGIN PAGE
═══════════════════════════════════════════════════════════════ */
function initLogin() {
  const form       = document.getElementById('login-form');
  const emailInput = document.getElementById('login-email');
  const passInput  = document.getElementById('login-password');
  const submitBtn  = document.getElementById('login-submit-btn');
  const alertEl    = document.getElementById('login-alert');
  const toggleBtn  = document.getElementById('toggle-login-password');

  // ── Password visibility toggle ────────────────────────────────────────────
  toggleBtn?.addEventListener('click', () => {
    const isVisible = passInput.type === 'text';
    passInput.type = isVisible ? 'password' : 'text';
    toggleBtn.setAttribute('aria-pressed', String(!isVisible));
    toggleBtn.textContent = isVisible ? '👁' : '🙈';
  });

  // ── Show inline alert ─────────────────────────────────────────────────────
  const showAlert = (message) => {
    alertEl.textContent = `⚠ ${message}`;
    alertEl.classList.add('visible');
  };

  const hideAlert = () => alertEl.classList.remove('visible');

  // ── Client-side validation ────────────────────────────────────────────────
  const validate = () => {
    const email    = emailInput.value.trim();
    const password = passInput.value;

    if (!email) {
      showAlert('Please enter your email address.');
      emailInput.focus();
      return false;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      showAlert('Please enter a valid email address.');
      emailInput.focus();
      return false;
    }
    if (!password) {
      showAlert('Please enter your password.');
      passInput.focus();
      return false;
    }
    return true;
  };

  // ── Form submit ───────────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    if (!validate()) return;

    const email    = emailInput.value.trim().toLowerCase();
    const password = passInput.value;

    // Set loading state
    submitBtn.textContent = 'Logging in…';
    submitBtn.classList.add('btn--loading');
    submitBtn.disabled = true;

    try {
      const data = await API.post('/auth/login', { email, password });

      // ── SUCCESS ──────────────────────────────────────────────────────────
      // 1. Save JWT to localStorage (as required)
      Auth.setToken(data.token);

      // 2. Cache the user object for navbar & dashboard use
      localStorage.setItem('nexus_user', JSON.stringify(data.data.user));

      // 3. Redirect to dashboard
      Toast.success('Login successful! Redirecting…');
      window.location.replace('/dashboard.html');

    } catch (err) {
      // ── ERROR — alert() as required ───────────────────────────────────────
      alert(`Login failed: ${err.message}`);
      showAlert(err.message);
    } finally {
      submitBtn.textContent = 'Log In';
      submitBtn.classList.remove('btn--loading');
      submitBtn.disabled = false;
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   REGISTER PAGE
═══════════════════════════════════════════════════════════════ */
function initRegister() {
  const form           = document.getElementById('register-form');
  const firstNameInput = document.getElementById('register-first-name');
  const lastNameInput  = document.getElementById('register-last-name');
  const emailInput     = document.getElementById('register-email');
  const passInput      = document.getElementById('register-password');
  const confirmInput   = document.getElementById('register-confirm-password');
  const submitBtn      = document.getElementById('register-submit-btn');
  const alertEl        = document.getElementById('register-alert');
  const toggleBtn      = document.getElementById('toggle-register-password');
  const roleInputs     = document.querySelectorAll('input[name="role"]');
  const companyField   = document.getElementById('company-name-field');
  const strengthBar    = document.getElementById('password-strength-bar');
  const strengthLabel  = document.getElementById('password-strength-label');
  const strengthWrapper = document.getElementById('password-strength-wrapper');

  // ── Password visibility toggle ────────────────────────────────────────────
  toggleBtn?.addEventListener('click', () => {
    const isVisible = passInput.type === 'text';
    passInput.type = isVisible ? 'password' : 'text';
    toggleBtn.setAttribute('aria-pressed', String(!isVisible));
    toggleBtn.textContent = isVisible ? '👁' : '🙈';
  });

  // ── Role toggle → show/hide company field ─────────────────────────────────
  const handleRoleChange = () => {
    const selected = document.querySelector('input[name="role"]:checked')?.value;
    if (!companyField) return;
    if (selected === 'recruiter') {
      companyField.style.display = 'flex';
      companyField.querySelector('input')?.setAttribute('required', 'true');
    } else {
      companyField.style.display = 'none';
      companyField.querySelector('input')?.removeAttribute('required');
    }
  };

  roleInputs.forEach((r) => r.addEventListener('change', handleRoleChange));
  handleRoleChange(); // Run once on load

  // ── Password strength meter ───────────────────────────────────────────────
  const getStrength = (pwd) => {
    let score = 0;
    if (pwd.length >= 8)  score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    return score; // 0-5
  };

  const STRENGTH_CONFIG = [
    { label: 'Very weak',  color: '#ef4444', width: '15%' },
    { label: 'Weak',       color: '#f97316', width: '30%' },
    { label: 'Fair',       color: '#eab308', width: '50%' },
    { label: 'Good',       color: '#22c55e', width: '75%' },
    { label: 'Strong',     color: '#10b981', width: '90%' },
    { label: '💪 Very strong', color: '#00c896', width: '100%' },
  ];

  passInput?.addEventListener('input', () => {
    const pwd = passInput.value;
    if (!pwd) {
      strengthWrapper.style.display = 'none';
      return;
    }
    strengthWrapper.style.display = 'block';
    strengthWrapper.setAttribute('aria-hidden', 'false');
    const score  = Math.min(getStrength(pwd), 5);
    const config = STRENGTH_CONFIG[score];
    strengthBar.style.width      = config.width;
    strengthBar.style.background = config.color;
    strengthLabel.textContent    = config.label;
    strengthLabel.style.color    = config.color;
  });

  // ── Inline field error helper ─────────────────────────────────────────────
  const setFieldError = (id, message) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('visible', !!message);
  };

  const clearAllErrors = () => {
    document.querySelectorAll('.form-error').forEach((el) => {
      el.textContent = '';
      el.classList.remove('visible');
    });
    alertEl.classList.remove('visible');
  };

  const showAlert = (msg) => {
    alertEl.textContent = `⚠ ${msg}`;
    alertEl.classList.add('visible');
  };

  // ── Client-side validation ────────────────────────────────────────────────
  const validate = () => {
    clearAllErrors();
    let valid = true;

    if (!firstNameInput.value.trim()) {
      setFieldError('first-name-error', 'First name is required.');
      valid = false;
    }
    if (!lastNameInput.value.trim()) {
      setFieldError('last-name-error', 'Last name is required.');
      valid = false;
    }
    const email = emailInput.value.trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setFieldError('register-email-error', 'A valid email address is required.');
      valid = false;
    }
    const password = passInput.value;
    if (password.length < 8) {
      setFieldError('register-password-error', 'Password must be at least 8 characters.');
      valid = false;
    }
    if (password !== confirmInput.value) {
      setFieldError('confirm-password-error', 'Passwords do not match.');
      valid = false;
    }
    const role = document.querySelector('input[name="role"]:checked')?.value;
    if (role === 'recruiter') {
      const company = document.getElementById('register-company')?.value.trim();
      if (!company) {
        setFieldError('company-name-error', 'Company name is required for recruiters.');
        valid = false;
      }
    }
    const termsChecked = document.getElementById('agree-terms')?.checked;
    if (!termsChecked) {
      setFieldError('terms-error', 'You must agree to the Terms of Service to continue.');
      valid = false;
    }

    return valid;
  };

  // ── Form submit ───────────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validate()) return;

    const role = document.querySelector('input[name="role"]:checked')?.value;
    const companyName = document.getElementById('register-company')?.value.trim();

    const payload = {
      firstName: firstNameInput.value.trim(),
      lastName:  lastNameInput.value.trim(),
      email:     emailInput.value.trim().toLowerCase(),
      password:  passInput.value,
      role,
    };

    // Include recruiterProfile in registration so company name is persisted to DB
    if (role === 'recruiter' && companyName) {
      payload.recruiterProfile = { companyName };
    }

    submitBtn.textContent = 'Creating account…';
    submitBtn.classList.add('btn--loading');
    submitBtn.disabled = true;

    try {
      const data = await API.post('/auth/register', payload);

      // ── SUCCESS ──────────────────────────────────────────────────────────
      Auth.setToken(data.token);
      localStorage.setItem('nexus_user', JSON.stringify(data.data.user));

      Toast.success('Account created! Taking you to your dashboard…');
      window.location.replace('/dashboard.html');

    } catch (err) {
      // ── ERROR — alert() as required ───────────────────────────────────────
      alert(`Registration failed: ${err.message}`);
      showAlert(err.message);
    } finally {
      submitBtn.textContent = 'Create Account';
      submitBtn.classList.remove('btn--loading');
      submitBtn.disabled = false;
    }
  });
}
