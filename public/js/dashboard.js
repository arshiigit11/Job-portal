/**
 * dashboard.js — Full dashboard logic for dashboard.html
 *
 * Depends on: api.js (loaded first via <script>)
 *
 * Responsibilities:
 *  1. Auth guard — redirect to /login.html if no valid token
 *  2. Role detection — decode JWT to get 'seeker' | 'recruiter'
 *  3. Show/hide role-specific sidebar nav + content panels
 *  4. Sidebar navigation — switch active view on click
 *  5. Seeker features:
 *     - Overview stats (counts from applications)
 *     - My Applications table with status filter + load more
 *     - Browse Jobs panel (reuses job card builder)
 *  6. Recruiter features:
 *     - Overview stats (listings, total applicants, views)
 *     - My Listings table with status filter
 *     - Applicants table with job filter + status filter
 *     - Post a Job form → POST /api/v1/jobs
 *     - Status update modal → PATCH /api/v1/applications/:id/status
 *  7. Profile form (shared) → GET /api/v1/auth/me + PATCH placeholder
 *  8. Sidebar logout button
 *  9. Mobile sidebar toggle (hamburger)
 */

document.addEventListener('DOMContentLoaded', async () => {

  // ── 1. Auth guard ──────────────────────────────────────────────────────────
  if (!Auth.requireAuth()) return;

  const role = Auth.getRole();   // 'seeker' | 'recruiter'
  const userId = Auth.getUserId();

  if (!role) {
    alert('Session invalid. Please log in again.');
    Auth.logout();
    return;
  }

  // ── 2. Populate sidebar user block ─────────────────────────────────────────
  const stored = JSON.parse(localStorage.getItem('nexus_user') || 'null');

  const sidebarName   = document.getElementById('sidebar-user-name');
  const sidebarRole   = document.getElementById('sidebar-user-role');
  const sidebarAvatar = document.getElementById('sidebar-avatar');

  let currentUser = stored;

  if (stored) {
    const fullName = `${stored.firstName} ${stored.lastName}`;
    if (sidebarName)   sidebarName.textContent   = fullName;
    if (sidebarRole)   sidebarRole.textContent   = Fmt.label(stored.role ?? role);
    if (sidebarAvatar) sidebarAvatar.textContent = Fmt.initials(fullName);
  }

  // ── 3. Role-based visibility ───────────────────────────────────────────────
  applyRoleVisibility(role);

  // ── 4. Sidebar nav wiring ──────────────────────────────────────────────────
  initSidebarNav();

  // ──────────────────────────────────────────────────────────────────────────
  // IMPORTANT: openStatusModal is exposed on window HERE — before any async
  // data fetching — so that table row onclick handlers can always find it,
  // regardless of whether the page has finished loading data.
  // DOM elements are looked up lazily on each call to avoid order issues.
  // ──────────────────────────────────────────────────────────────────────────
  window.openStatusModal = (applicationId, applicantName) => {
    const overlay      = document.getElementById('status-modal-overlay');
    const appIdInput   = document.getElementById('status-application-id');
    const applicantEl  = document.getElementById('status-modal-applicant');
    const errorEl      = document.getElementById('status-modal-error');
    const selectEl     = document.getElementById('status-select');
    const notesEl      = document.getElementById('recruiter-notes-input');

    if (!overlay) {
      alert('Status modal not found in the page. Please refresh.');
      return;
    }

    if (appIdInput)  appIdInput.value  = applicationId;
    if (applicantEl) applicantEl.textContent = `Updating status for: ${applicantName}`;
    if (errorEl)     errorEl.classList.remove('visible');
    if (selectEl)    selectEl.value = '';
    if (notesEl)     notesEl.value  = '';

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    selectEl?.focus();
  };

  window.closeStatusModal = () => {
    const overlay = document.getElementById('status-modal-overlay');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  };

  // ── 5. Mobile sidebar toggle ───────────────────────────────────────────────
  initMobileSidebar();

  // ── 6. Logout ──────────────────────────────────────────────────────────────
  document.getElementById('sidebar-logout-btn')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to log out?')) Auth.logout();
  });


  // ── 8. Topbar quick-post button ────────────────────────────────────────────
  document.getElementById('topbar-post-job-btn')?.addEventListener('click', () => {
    switchView('post-job');
    highlightNav('nav-post-job');
  });
  document.getElementById('overview-post-job-btn')?.addEventListener('click', () => {
    switchView('post-job');
    highlightNav('nav-post-job');
  });

  /* ═══════════════════════════════════════════════════════════════
     ROLE VISIBILITY
  ═══════════════════════════════════════════════════════════════ */
  function applyRoleVisibility(role) {
    document.querySelectorAll('.seeker-view').forEach((el) => {
      el.style.display = role === 'seeker' ? '' : 'none';
    });
    document.querySelectorAll('.recruiter-view').forEach((el) => {
      el.style.display = role === 'recruiter' ? '' : 'none';
    });
    // Mark the page wrapper with a data attribute for CSS hooks
    document.getElementById('dashboard-page')?.setAttribute('data-role', role);
  }

  /* ═══════════════════════════════════════════════════════════════
     SIDEBAR NAV
  ═══════════════════════════════════════════════════════════════ */
  function initSidebarNav() {
    document.querySelectorAll('.sidebar__nav-item[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        switchView(view);
        highlightNav(btn.id);
        // Close sidebar on mobile after selection
        closeMobileSidebar();
      });
    });

    // "View All" link in the activity table
    document.getElementById('view-all-activity-btn')?.addEventListener('click', () => {
      const viewId = role === 'seeker' ? 'my-applications' : 'my-listings';
      switchView(viewId);
      highlightNav(role === 'seeker' ? 'nav-my-applications' : 'nav-my-listings');
    });
  }

  function highlightNav(activeId) {
    document.querySelectorAll('.sidebar__nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.id === activeId);
      btn.setAttribute('aria-current', btn.id === activeId ? 'page' : 'false');
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     VIEW SWITCHING
  ═══════════════════════════════════════════════════════════════ */

  // Track the currently active view so status modal can refresh it reliably
  let _currentView = 'overview';

  async function switchView(viewName) {
    // Expose on window so inline onclick="window._switchView(...)" in table rows works
    window._switchView = switchView;
    // Hide all view panels
    document.querySelectorAll('.dashboard-view').forEach((v) => {
      v.style.display = 'none';
    });

    // Show the target panel
    const target = document.querySelector(`.dashboard-view[data-view="${viewName}"]`);
    if (target) {
      target.style.display = '';
      target.style.animation = 'fade-in 0.3s ease both';
    }

    // Remember which view is now active
    _currentView = viewName;

    // Update topbar title
    const TITLES = {
      overview:          'Overview',
      'my-applications': 'My Applications',
      'my-listings':     'My Job Listings',
      applicants:        'Applicants',
      'post-job':        'Post a Job',
      'browse-jobs':     'Browse Jobs',
      'saved-jobs':      'Saved Jobs',
      profile:           'My Profile',
      interviews:        'My Interviews',

      'ai-score':        'AI Resume Score',
      predictor:         'Placement Predictor',
      chat:              'Chat & Board',
      analytics:         'Hiring Analytics',
      alerts:            'Job Alerts',
    };
    const topbarTitle = document.getElementById('topbar-title');
    if (topbarTitle) topbarTitle.textContent = TITLES[viewName] ?? 'Dashboard';

    // Load data for the view
    switch (viewName) {
      case 'overview':        await loadOverview();         break;
      case 'my-applications': await loadMyApplications();   break;
      case 'my-listings':     await loadMyListings();        break;
      case 'applicants':      await loadApplicants();        break;
      case 'post-job':        initPostJobForm();             break;
      case 'browse-jobs':     await loadBrowseJobs();        break;
      case 'saved-jobs':      loadSavedJobs();               break;
      case 'profile':         await loadProfile();           break;
      case 'interviews':      await loadInterviews();        break;

      case 'ai-score':        loadAiScore();                 break;
      case 'predictor':       initPredictor();               break;
      case 'chat':            loadChatBoard();               break;
      case 'analytics':       await loadAnalytics();         break;
      case 'alerts':          await loadAlerts();            break;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     MOBILE SIDEBAR
  ═══════════════════════════════════════════════════════════════ */
  function initMobileSidebar() {
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar   = document.getElementById('sidebar');
    const overlay   = document.getElementById('sidebar-overlay');

    toggleBtn?.addEventListener('click', () => {
      const isOpen = sidebar.classList.toggle('open');
      toggleBtn.setAttribute('aria-expanded', String(isOpen));
      if (overlay) overlay.style.display = isOpen ? 'block' : 'none';
    });

    overlay?.addEventListener('click', closeMobileSidebar);
  }

  function closeMobileSidebar() {
    const sidebar   = document.getElementById('sidebar');
    const overlay   = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    sidebar?.classList.remove('open');
    if (overlay)   overlay.style.display = 'none';
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
  }

  /* ═══════════════════════════════════════════════════════════════
     OVERVIEW
  ═══════════════════════════════════════════════════════════════ */
  async function loadOverview() {
    // Update welcome name
    const welcomeName = document.getElementById('welcome-name');
    if (welcomeName && currentUser) {
      welcomeName.textContent = currentUser.firstName ?? 'there';
    }

    if (role === 'seeker') {
      await loadSeekerStats();
      await loadRecentApplications(5);
    } else {
      await loadRecruiterStats();
      await loadRecentApplicants(5);
    }
  }

  /* ─── Seeker overview stats ─────────────────────────────────── */
  // Exposed on window so applyFromDashboard success callback can refresh it
  async function loadSeekerStats() {
    try {
      const data = await API.get('/applications/my', { limit: 100 });
      const apps = data.data.applications ?? [];

      const counts = {
        total: apps.length,
        pending:     apps.filter((a) => a.status === 'pending').length,
        shortlisted: apps.filter((a) => a.status === 'shortlisted').length,
        accepted:    apps.filter((a) => a.status === 'accepted').length,
      };

      setText('stat-applied-count',     counts.total);
      setText('stat-pending-count',     counts.pending);
      setText('stat-shortlisted-count', counts.shortlisted);
      setText('stat-interviews-count',  counts.accepted);

      // Update sidebar badge
      setText('badge-applications', counts.total);

    } catch (err) {
      alert(`Failed to load stats: ${err.message}`);
    }
  }

  /* ─── Recruiter overview stats ──────────────────────────────── */
  // Exposed on window so handlePostJobSubmit (defined as window.X) can call it
  async function loadRecruiterStats() {
    try {
      // /jobs/my returns ALL of this recruiter's jobs (all statuses)
      const data = await API.get('/jobs/my', { limit: 100 });
      const jobs = data.data.jobs ?? [];

      const totalApplicants = jobs.reduce((acc, j) => acc + (j.applicationCount ?? 0), 0);
      const totalViews      = jobs.reduce((acc, j) => acc + (j.viewCount ?? 0), 0);
      const openJobs        = jobs.filter((j) => j.status === 'open');

      setText('stat-listings-count',      openJobs.length);
      setText('stat-applicants-count',    totalApplicants);
      setText('stat-views-count',         totalViews);

      // Sidebar badge
      setText('badge-listings',   openJobs.length);
      setText('badge-applicants', totalApplicants);

      // Pending review estimate (applicants in 'pending' status)
      try {
        let pending = 0;
        for (const job of jobs.slice(0, 5)) {
          const appData = await API.get(`/applications/job/${job._id}`, { limit: 100 });
          pending += (appData.data.applications ?? []).filter((a) => a.status === 'pending').length;
        }
        setText('stat-pending-review-count', pending);
      } catch {
        setText('stat-pending-review-count', '—');
      }

    } catch (err) {
      console.error('Failed to load recruiter stats:', err);
    }
  }

  /* ─── Analytics Dashboard ────────────────────────────────────── */
  async function loadAnalytics() {
    try {
      const data = await API.get('/jobs/my', { limit: 100 });
      const jobs = data.data.jobs ?? [];
      
      let totalApps = 0;
      let shortlisted = 0;
      let hired = 0;

      for (const job of jobs) {
        totalApps += (job.applicationCount ?? 0);
        try {
          const appData = await API.get(`/applications/job/${job._id}`, { limit: 100 });
          const apps = appData.data.applications ?? [];
          shortlisted += apps.filter(a => a.status === 'shortlisted').length;
          hired += apps.filter(a => a.status === 'accepted').length;
        } catch(e) {}
      }

      setText('analytics-total-jobs', jobs.length);
      setText('analytics-total-apps', totalApps);
      setText('analytics-shortlisted', shortlisted);
      setText('analytics-hired', hired);

      const funnel = document.getElementById('funnel-chart');
      if (funnel) funnel.innerHTML = '<div style="padding: 2rem; color: var(--text-muted); text-align: center; height: 100%; display: flex; align-items: center; justify-content: center;">Data visualizations are currently being updated.</div>';
      
    } catch (err) {
      console.error('Failed to load analytics:', err);
    }
  }

  /* ─── Recent activity table (seeker) ───────────────────────── */
  async function loadRecentApplications(limit = 5) {
    const tbody    = document.getElementById('activity-table-body');
    const emptyRow = document.getElementById('activity-table-empty');
    if (!tbody) return;

    try {
      const data = await API.get('/applications/my', { limit });
      const apps = data.data.applications ?? [];

      if (apps.length === 0) {
        if (emptyRow) emptyRow.style.display = '';
        return;
      }

      if (emptyRow) emptyRow.style.display = 'none';

      const rows = apps.map((app) => {
        const job = app.jobId ?? {};
        return `
          <tr>
            <td style="color:var(--text-primary); font-weight:500;">
              ${escHtml(job.title ?? 'Unknown job')}
            </td>
            <td>${escHtml(job.company ?? '—')}</td>
            <td>
              <span class="badge ${Fmt.statusBadge(app.status)}">
                ${Fmt.label(app.status)}
              </span>
            </td>
            <td>${Fmt.date(app.createdAt)}</td>
            <td>
              <button
                class="btn btn--ghost btn--sm"
                onclick="viewJobDetail('${escHtml(String(job._id))}')"
                aria-label="View job listing"
              >→</button>
            </td>
          </tr>
        `;
      });

      tbody.innerHTML = rows.join('');

    } catch (err) {
      alert(`Failed to load recent activity: ${err.message}`);
    }
  }

  /* ─── Recent activity table (recruiter) ────────────────────── */
  async function loadRecentApplicants(limit = 5) {
    const tbody    = document.getElementById('activity-table-body');
    const emptyRow = document.getElementById('activity-table-empty');
    if (!tbody) return;

    try {
      // Use /jobs/my — returns only this recruiter's own jobs, all statuses
      const jobsData = await API.get('/jobs/my', { limit: 50, sort: 'newest' });
      const myJobs   = jobsData.data.jobs ?? [];

      if (myJobs.length === 0) {
        const titleEl = document.getElementById('activity-table-title');
        if (titleEl) titleEl.textContent = 'Recent Activity';
        if (emptyRow) {
          emptyRow.style.display = '';
          const td = emptyRow.querySelector('td');
          if (td) td.innerHTML =
            'No listings yet. Click <strong>Post a Job</strong> in the sidebar to get started.';
        }
        return;
      }

      // Load applicants for the recruiter's own most-recent job
      const firstJob = myJobs[0];
      const appData  = await API.get(`/applications/job/${firstJob._id}`, { limit });
      const apps     = appData.data.applications ?? [];

      const titleEl = document.getElementById('activity-table-title');
      if (titleEl) titleEl.textContent = `Applicants — ${firstJob.title}`;

      if (apps.length === 0 && emptyRow) {
        emptyRow.style.display = '';
        const td = emptyRow.querySelector('td');
        if (td) td.textContent = 'No applicants yet for your most recent listing.';
        return;
      }

      if (emptyRow) emptyRow.style.display = 'none';

      tbody.innerHTML = apps.map((app) => {
        const seeker = app.applicantId ?? {};
        return `
          <tr>
            <td style="color:var(--text-primary); font-weight:500;">
              <div class="company-cell">
                <div class="navbar__avatar" style="width:28px;height:28px;font-size:0.7rem;">
                  ${Fmt.initials(`${seeker.firstName ?? ''} ${seeker.lastName ?? ''}`)}
                </div>
                ${escHtml(`${seeker.firstName ?? ''} ${seeker.lastName ?? ''}`)}
              </div>
            </td>
            <td>${escHtml(seeker.email ?? '—')}</td>
            <td>
              <span class="badge ${Fmt.statusBadge(app.status)}">${Fmt.label(app.status)}</span>
            </td>
            <td>${Fmt.date(app.createdAt)}</td>
            <td>
              <div style="display:flex; gap:0.5rem; justify-content:flex-end;">
                <button
                  class="btn btn--ghost btn--sm"
                  onclick="window.openStatusModal('${escHtml(String(app._id))}', '${escHtml(`${seeker.firstName ?? ''} ${seeker.lastName ?? ''}`)}')"
                  aria-label="Update application status"
                >Update</button>
                <button
                  class="btn btn--outline btn--sm"
                  onclick="window.openScheduleModal('${escHtml(String(app._id))}', '${escHtml(`${seeker.firstName ?? ''} ${seeker.lastName ?? ''}`)}')"
                  aria-label="Schedule interview"
                >Schedule</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

    } catch (err) {
      alert(`Failed to load recent applicants: ${err.message}`);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     MY APPLICATIONS (Seeker)
  ═══════════════════════════════════════════════════════════════ */
  let appPage = 1;
  let appTotalPages = 1;

  async function loadMyApplications(page = 1, append = false) {
    const tbody    = document.getElementById('my-applications-body');
    const emptyRow = document.getElementById('my-applications-empty');
    const filter   = document.getElementById('applications-status-filter')?.value;
    const loadMoreWrap = document.getElementById('my-applications-pagination');

    if (!tbody) return;

    // Detach emptyRow BEFORE clearing innerHTML so we keep the reference
    if (!append && emptyRow && emptyRow.parentNode === tbody) {
      tbody.removeChild(emptyRow);
    }
    if (!append) tbody.innerHTML = '';

    try {
      const params = { page, limit: 10 };
      if (filter) params.status = filter;

      const data = await API.get('/applications/my', params);
      const apps = data.data.applications ?? [];
      const pg   = data.pagination ?? {};

      appPage       = page;
      appTotalPages = pg.totalPages ?? 1;

      if (apps.length === 0 && !append) {
        // Re-attach emptyRow and show it
        if (emptyRow) {
          emptyRow.style.display = '';
          tbody.appendChild(emptyRow);
        }
        if (loadMoreWrap) loadMoreWrap.style.display = 'none';
        return;
      }

      // Hide empty row (it's detached from DOM if not append, so just ensure style)
      if (emptyRow) emptyRow.style.display = 'none';

      apps.forEach((app) => {
        const job = app.jobId ?? {};
        const tr  = document.createElement('tr');
        tr.innerHTML = `
          <td style="color:var(--text-primary); font-weight:500;">${escHtml(job.title ?? 'Listing removed')}</td>
          <td>${escHtml(job.company ?? '—')}</td>
          <td>${escHtml(job.location ?? '—')}</td>
          <td>${Fmt.date(app.createdAt)}</td>
          <td><span class="badge ${Fmt.statusBadge(app.status)}">${Fmt.label(app.status)}</span></td>
          <td>
            <button
              class="btn btn--ghost btn--sm"
              onclick="window._switchView('browse-jobs')"
              aria-label="Browse more jobs"
            >🔍</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      if (loadMoreWrap) {
        loadMoreWrap.style.display = appPage < appTotalPages ? 'block' : 'none';
      }

    } catch (err) {
      alert(`Failed to load applications: ${err.message}`);
    }
  }

  // Status filter change
  document.getElementById('applications-status-filter')?.addEventListener('change', () => {
    loadMyApplications(1, false);
  });

  // Load more
  document.getElementById('load-more-applications-btn')?.addEventListener('click', () => {
    loadMyApplications(appPage + 1, true);
  });

  /* ═══════════════════════════════════════════════════════════════
     MY LISTINGS (Recruiter)
  ═══════════════════════════════════════════════════════════════ */
  async function loadMyListings() {
    const tbody    = document.getElementById('my-listings-body');
    const emptyRow = document.getElementById('my-listings-empty');
    const filter   = document.getElementById('listings-status-filter')?.value;

    if (!tbody) return;

    // Detach emptyRow before clearing so reference stays valid
    if (emptyRow && emptyRow.parentNode === tbody) {
      tbody.removeChild(emptyRow);
    }
    tbody.innerHTML = '';

    try {
      // /jobs/my returns only this recruiter's listings — all statuses, no client-side filter needed
      const params = { limit: 100, sort: 'newest' };
      if (filter) params.status = filter;

      const data = await API.get('/jobs/my', params);
      const jobs  = data.data.jobs ?? [];

      if (jobs.length === 0) {
        if (emptyRow) {
          emptyRow.style.display = '';
          tbody.appendChild(emptyRow);
        }
        return;
      }

      if (emptyRow) emptyRow.style.display = 'none';

      jobs.forEach((job) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="color:var(--text-primary); font-weight:500;">${escHtml(job.title)}</td>
          <td><span class="badge badge--gray">${Fmt.label(job.jobType)}</span></td>
          <td>${job.applicationCount ?? 0}</td>
          <td>${job.viewCount ?? 0}</td>
          <td><span class="badge ${Fmt.statusBadge(job.status)}">${Fmt.label(job.status)}</span></td>
          <td>${Fmt.date(job.createdAt)}</td>
          <td style="display:flex;gap:6px;">
            <button
              class="btn btn--ghost btn--sm"
              onclick="window.loadApplicantsForJob('${job._id}')"
              aria-label="View applicants for this job"
            >👥 Applicants</button>
            <button
              class="btn btn--danger btn--sm"
              onclick="window.deleteJob('${job._id}', this)"
              aria-label="Delete this job listing"
            >🗑</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

    } catch (err) {
      alert(`Failed to load listings: ${err.message}`);
    }
  }

  // Status filter
  document.getElementById('listings-status-filter')?.addEventListener('change', loadMyListings);

  // Post New button inside table header
  document.getElementById('listings-post-new-btn')?.addEventListener('click', () => {
    switchView('post-job');
    highlightNav('nav-post-job');
  });

  /* ═══════════════════════════════════════════════════════════════
     APPLICANTS (Recruiter)
  ═══════════════════════════════════════════════════════════════ */
  async function loadApplicants() {
    const jobFilter    = document.getElementById('applicants-job-filter')?.value;
    const statusFilter = document.getElementById('applicants-status-filter')?.value;

    // Populate job dropdown if empty
    await populateJobsDropdown();

    if (jobFilter) {
      await fetchApplicantsForJob(jobFilter, statusFilter);
    } else {
      // Load applicants for the first job found
      const select = document.getElementById('applicants-job-filter');
      const firstVal = select?.options[1]?.value; // index 0 is "All My Jobs" placeholder
      if (firstVal) await fetchApplicantsForJob(firstVal, statusFilter);
    }
  }

  async function populateJobsDropdown() {
    const select = document.getElementById('applicants-job-filter');
    if (!select || select.options.length > 1) return; // Already populated

    try {
      // /jobs/my returns all of this recruiter's jobs — all statuses
      const data = await API.get('/jobs/my', { limit: 100, sort: 'newest' });
      const myJobs  = data.data.jobs ?? [];

      myJobs.forEach((job) => {
        const opt   = document.createElement('option');
        opt.value   = job._id;
        opt.textContent = `${job.title} (${job.applicationCount ?? 0} applicants)`;
        select.appendChild(opt);
      });
    } catch (err) {
      alert(`Failed to load your jobs: ${err.message}`);
    }
  }

  async function fetchApplicantsForJob(jobId, statusFilter) {
    const tbody    = document.getElementById('applicants-table-body');
    const emptyRow = document.getElementById('applicants-empty');
    if (!tbody) return;

    // Detach emptyRow before clearing so reference stays valid
    if (emptyRow && emptyRow.parentNode === tbody) {
      tbody.removeChild(emptyRow);
    }
    tbody.innerHTML = '';

    try {
      const params = { limit: 50 };
      if (statusFilter) params.status = statusFilter;

      const data = await API.get(`/applications/job/${jobId}`, params);
      const apps = data.data.applications ?? [];

      if (apps.length === 0) {
        if (emptyRow) {
          emptyRow.style.display = '';
          tbody.appendChild(emptyRow);
        }
        return;
      }

      if (emptyRow) emptyRow.style.display = 'none';

      apps.forEach((app) => {
        const seeker = app.applicantId ?? {};
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <div class="company-cell">
              <div class="navbar__avatar" style="width:30px;height:30px;font-size:0.75rem;">
                ${Fmt.initials(`${seeker.firstName ?? ''} ${seeker.lastName ?? ''}`)}
              </div>
              <span style="color:var(--text-primary);font-weight:500;">
                ${escHtml(`${seeker.firstName ?? ''} ${seeker.lastName ?? ''}`)}
              </span>
            </div>
          </td>
          <td>${escHtml(seeker.email ?? '—')}</td>
          <td>${escHtml(app.jobId?.title ?? '—')}</td>
          <td>${Fmt.date(app.createdAt)}</td>
          <td>
            <span class="badge ${Fmt.statusBadge(app.status)}">${Fmt.label(app.status)}</span>
          </td>
          <td>
            <div style="display:flex; gap:0.5rem; justify-content:flex-end;">
              <button
                class="btn btn--primary btn--sm"
                onclick="window.openStatusModal('${escHtml(String(app._id))}', '${escHtml(`${seeker.firstName ?? ''} ${seeker.lastName ?? ''}`)}')"
                aria-label="Update status for ${escHtml(`${seeker.firstName ?? ''} ${seeker.lastName ?? ''}`)}"
              >Update Status</button>
              <button
                class="btn btn--outline btn--sm"
                onclick="window.openScheduleModal('${escHtml(String(app._id))}', '${escHtml(`${seeker.firstName ?? ''} ${seeker.lastName ?? ''}`)}')"
                aria-label="Schedule interview for ${escHtml(`${seeker.firstName ?? ''} ${seeker.lastName ?? ''}`)}"
              >Schedule</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });

    } catch (err) {
      alert(`Failed to load applicants: ${err.message}`);
    }
  }

  // Filter changes
  document.getElementById('applicants-job-filter')?.addEventListener('change', (e) => {
    const statusFilter = document.getElementById('applicants-status-filter')?.value;
    fetchApplicantsForJob(e.target.value, statusFilter);
  });
  document.getElementById('applicants-status-filter')?.addEventListener('change', () => {
    const jobId = document.getElementById('applicants-job-filter')?.value;
    const statusFilter = document.getElementById('applicants-status-filter')?.value;
    if (jobId) fetchApplicantsForJob(jobId, statusFilter);
  });

  /* ═══════════════════════════════════════════════════════════════
     POST A JOB (Recruiter)
  ═══════════════════════════════════════════════════════════════ */
  function initPostJobForm() {
    // This function is called from switchView('post-job') to reset UI state.
    // The actual form submit listener is wired ONCE, immediately below this function.
    const alertEl   = document.getElementById('post-job-alert');
    const successEl = document.getElementById('post-job-success');
    if (alertEl)   alertEl.classList.remove('visible');
    if (successEl) successEl.classList.remove('visible');
  }

  // ── Global post-job handler — called directly from HTML onsubmit/onclick ─────
  // Defined as window.handlePostJobSubmit so the inline HTML attribute can always
  // find it. No closure timing issues possible with this approach.
  window.handlePostJobSubmit = async function(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();

    console.log("Publish button clicked");

    const form      = document.getElementById('post-job-form');
    const submitBtn = document.getElementById('post-job-submit-btn');
    const alertEl   = document.getElementById('post-job-alert');
    const successEl = document.getElementById('post-job-success');
    const descInput = document.getElementById('job-description');
    const descCount = document.getElementById('job-description-count');

    if (alertEl)   alertEl.classList.remove('visible');
    if (successEl) successEl.classList.remove('visible');
    
    // Clear inline errors
    document.querySelectorAll('#post-job-form .form-error').forEach(el => {
      el.textContent = '';
      el.classList.remove('visible');
    });

    const title       = document.getElementById('job-title')?.value.trim();
    const company     = document.getElementById('job-company')?.value.trim();
    const location    = document.getElementById('job-location')?.value.trim();
    const description = descInput?.value.trim();

    // ── Validation ────────────────────────────────────────────────────────────
    if (!title) {
      const el = document.getElementById('job-title-error');
      if (el) {
        el.textContent = 'Job title is required.';
        el.classList.add('visible');
      }
      document.getElementById('job-title')?.focus();
      return false;
    }
    if (!company) {
      const el = document.getElementById('job-company-error');
      if (el) {
        el.textContent = 'Company name is required.';
        el.classList.add('visible');
      }
      document.getElementById('job-company')?.focus();
      return false;
    }
    if (!location) {
      const el = document.getElementById('job-location-error');
      if (el) {
        el.textContent = 'Location is required.';
        el.classList.add('visible');
      }
      document.getElementById('job-location')?.focus();
      return false;
    }
    if (!description || description.length < 10) {
      const el = document.getElementById('job-description-error');
      if (el) {
        el.textContent = 'Description must be at least 10 characters.';
        el.classList.add('visible');
      }
      descInput?.focus();
      return false;
    }

    // ── Build payload ─────────────────────────────────────────────────────────
    const salaryMin  = Number(document.getElementById('salary-min')?.value)  || undefined;
    const salaryMax  = Number(document.getElementById('salary-max')?.value)  || undefined;
    const salaryCurr = document.getElementById('salary-currency')?.value     || 'USD';
    const salaryPer  = document.getElementById('salary-period')?.value       || 'yearly';
    const isNeg      = document.getElementById('salary-negotiable')?.checked ?? false;

    const salary = (salaryMin || salaryMax)
      ? { min: salaryMin, max: salaryMax, currency: salaryCurr, period: salaryPer, isNegotiable: isNeg }
      : undefined;

    const skillsRaw = document.getElementById('job-skills')?.value ?? '';
    const skills    = skillsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const deadline  = document.getElementById('job-deadline')?.value || undefined;

    const payload = {
      title,
      company,
      location,
      description,
      locationType:    document.getElementById('job-location-type')?.value || 'on-site',
      jobType:         document.getElementById('job-type')?.value          || 'full-time',
      experienceLevel: document.getElementById('job-experience')?.value    || 'mid',
      category:        document.getElementById('job-category')?.value?.trim() || undefined,
      salary,
      skills,
      applicationDeadline: deadline,
    };

    // ── Disable button & submit ───────────────────────────────────────────────
    if (submitBtn) {
      submitBtn.textContent = 'Publishing…';
      submitBtn.classList.add('btn--loading');
      submitBtn.disabled = true;
    }

    try {
      const data = await API.post('/jobs', payload);

      if (form) form.reset();
      if (descCount) descCount.textContent = '0 / 10,000';

      if (successEl) {
        successEl.textContent = `✅ "${data.data.job.title}" posted! Click My Listings to view it.`;
        successEl.classList.add('visible');
      }

      if (typeof Toast !== 'undefined') Toast.success('Job listing published! 🎉');

      // Refresh recruiter stats (use the window-exposed version, since this
      // function is defined on window and runs outside the closure)
      if (typeof window._loadRecruiterStats === 'function') window._loadRecruiterStats();

    } catch (err) {
      const msg = err?.message || 'Failed to post job. Please try again.';
      if (alertEl) {
        alertEl.textContent = msg;
        alertEl.classList.add('visible');
      }
      if (typeof Toast !== 'undefined') Toast.error(msg);
    } finally {
      if (submitBtn) {
        submitBtn.textContent = '🚀 Publish Job';
        submitBtn.classList.remove('btn--loading');
        submitBtn.disabled = false;
      }
    }

    return false; // prevent any native form submission
  };

  // Wire description character counter
  (function() {
    const descInput = document.getElementById('job-description');
    const descCount = document.getElementById('job-description-count');
    if (descInput && descCount) {
      descInput.addEventListener('input', () => {
        descCount.textContent = `${descInput.value.length.toLocaleString()} / 10,000`;
      });
    }
  })();



  /* ═══════════════════════════════════════════════════════════════
     STATUS UPDATE MODAL — event listener wiring
     (window.openStatusModal is defined earlier in this file,
      before any async calls, to avoid the race condition where
      a rendered table row's onclick can't find the function yet)
  ═══════════════════════════════════════════════════════════════ */
  const statusModalClose = document.getElementById('status-modal-close');
  const statusModal      = document.getElementById('status-modal-overlay');
  const statusForm       = document.getElementById('status-update-form');
  const statusSubmitBtn  = document.getElementById('status-modal-submit-btn');
  const statusModalError = document.getElementById('status-modal-error');

  // Close button and backdrop click
  statusModalClose?.addEventListener('click', window.closeStatusModal);
  statusModal?.addEventListener('click', (e) => {
    if (e.target === statusModal) window.closeStatusModal();
  });

  // Form submit → PATCH /api/v1/applications/:id/status
  statusForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const applicationId  = document.getElementById('status-application-id')?.value;
    const status         = document.getElementById('status-select')?.value;
    const recruiterNotes = document.getElementById('recruiter-notes-input')?.value.trim();

    if (!status) {
      alert('Please select a new status before submitting.');
      return;
    }
    if (!applicationId) {
      alert('Application ID is missing. Please close and try again.');
      return;
    }

    if (statusModalError) statusModalError.classList.remove('visible');

    statusSubmitBtn.textContent = 'Updating…';
    statusSubmitBtn.classList.add('btn--loading');
    statusSubmitBtn.disabled = true;

    try {
      await API.patch(`/applications/${applicationId}/status`, {
        status,
        recruiterNotes: recruiterNotes || undefined,
      });

      window.closeStatusModal();
      Toast.success(`Status updated to "${Fmt.label(status)}" ✅`);

      // Refresh the currently-visible view using the tracked variable (reliable)
      if (_currentView === 'applicants') await loadApplicants();
      if (_currentView === 'overview')   await loadRecentApplicants(5);
      if (_currentView === 'my-listings') await loadMyListings();

    } catch (err) {
      // alert() as required by spec
      alert(`Status update failed: ${err.message}`);
      if (statusModalError) {
        statusModalError.textContent = err.message;
        statusModalError.classList.add('visible');
      }
    } finally {
      statusSubmitBtn.textContent = 'Update Status';
      statusSubmitBtn.classList.remove('btn--loading');
      statusSubmitBtn.disabled = false;
    }
  });



  /* ═══════════════════════════════════════════════════════════════
     LOAD APPLICANTS FOR A SPECIFIC JOB (from My Listings)
     Called by the 👥 Applicants button in the listings table.
  ═══════════════════════════════════════════════════════════════ */
  window.loadApplicantsForJob = async (jobId) => {
    // Switch to the Applicants view first
    await switchView('applicants');
    highlightNav('nav-applicants');

    // Wait for the job dropdown to be populated, then select the job
    await populateJobsDropdown();
    const select = document.getElementById('applicants-job-filter');
    if (select && jobId) {
      select.value = jobId;
      const statusFilter = document.getElementById('applicants-status-filter')?.value;
      await fetchApplicantsForJob(jobId, statusFilter);
    }
  };

  /* ═══════════════════════════════════════════════════════════════
     DELETE JOB  (Recruiter)
  ═══════════════════════════════════════════════════════════════ */
  window.deleteJob = async (jobId, btn) => {
    if (!confirm('Delete this job listing? This action cannot be undone.')) return;

    const original = btn.textContent;
    btn.textContent = '…';
    btn.disabled = true;

    try {
      await API.delete(`/jobs/${jobId}`);
      Toast.success('Listing deleted.');
      await loadMyListings();
      await loadRecruiterStats();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
      btn.textContent = original;
      btn.disabled = false;
    }
  };

  /* ═══════════════════════════════════════════════════════════════
     BROWSE JOBS (Seeker inside Dashboard)
  ═══════════════════════════════════════════════════════════════ */
  async function loadBrowseJobs() {
    const grid    = document.getElementById('dashboard-jobs-grid');
    const loadMore = document.getElementById('dashboard-load-more-btn');
    const loadMoreWrap = document.getElementById('dashboard-load-more-wrapper');
    const searchForm = document.getElementById('dashboard-search-form');

    if (!grid) return;

    let dashPage = 1;
    let dashFilters = {};

    const fetchDashJobs = async (params = {}, append = false) => {
      if (!append) grid.innerHTML = '<p style="color:var(--text-muted);">Loading…</p>';

      try {
        const data = await API.get('/jobs', { page: dashPage, limit: 6, ...params });
        const jobs = data.data.jobs ?? [];
        const pg   = data.pagination ?? {};

        if (!append) grid.innerHTML = '';

        if (jobs.length === 0 && !append) {
          grid.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:var(--space-xl);">No jobs found.</p>`;
          if (loadMoreWrap) loadMoreWrap.style.display = 'none';
          return;
        }

        jobs.forEach((job) => {
          const card = buildDashJobCard(job);
          grid.appendChild(card);
        });

        if (loadMoreWrap) {
          loadMoreWrap.style.display = dashPage < (pg.totalPages ?? 1) ? 'block' : 'none';
        }
      } catch (err) {
        alert(`Failed to load jobs: ${err.message}`);
      }
    };

    searchForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      dashPage = 1;
      dashFilters.search   = document.getElementById('dashboard-search-keyword')?.value.trim() || undefined;
      dashFilters.location = document.getElementById('dashboard-search-location')?.value.trim() || undefined;
      fetchDashJobs(dashFilters, false);
    });

    loadMore?.addEventListener('click', () => {
      dashPage++;
      fetchDashJobs({ ...dashFilters, page: dashPage }, true);
    });

    // Initial load
    await fetchDashJobs({ sort: 'newest' });
  }

  /** Retrieves saved jobs from localStorage */
  function getSavedJobs() {
    try {
      return JSON.parse(localStorage.getItem('nexus_saved_jobs') || '[]');
    } catch {
      return [];
    }
  }

  /** Toggles the saved status of a job */
  function toggleSaveJob(job, btnEl) {
    let saved = getSavedJobs();
    const isSaved = saved.some(s => s._id === job._id);
    
    if (isSaved) {
      saved = saved.filter(s => s._id !== job._id);
      btnEl.classList.remove('saved');
      btnEl.textContent = '🏷️';
      btnEl.title = 'Save job';
      btnEl.setAttribute('aria-label', 'Save job');
      Toast.success('Job removed from saved list');
    } else {
      saved.push(job);
      btnEl.classList.add('saved');
      btnEl.textContent = '🔖';
      btnEl.title = 'Remove from saved';
      btnEl.setAttribute('aria-label', 'Remove from saved jobs');
      Toast.success('Job saved successfully');
    }
    localStorage.setItem('nexus_saved_jobs', JSON.stringify(saved));
  }

  /** Simplified card for the dashboard browse panel */
  function buildDashJobCard(job) {
    const saved = getSavedJobs();
    const isSaved = saved.some(s => s._id === job._id);

    const card = document.createElement('article');
    card.className = 'job-card';
    card.setAttribute('data-job-id', job._id);
    card.setAttribute('role', 'article');
    card.setAttribute('aria-label', `${job.title} at ${job.company}`);

    card.innerHTML = `
      <div class="job-card__header">
        <div class="job-card__meta">
          <div class="job-card__company">${escHtml(job.company)}</div>
          <h3 class="job-card__title">${escHtml(job.title)}</h3>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span class="badge ${Fmt.statusBadge(job.locationType)}">${Fmt.label(job.locationType)}</span>
          <button
            class="btn btn--ghost btn--sm save-job-btn${isSaved ? ' saved' : ''}"
            data-job-id="${escHtml(String(job._id))}"
            title="${isSaved ? 'Remove from saved' : 'Save job'}"
            aria-label="${isSaved ? 'Remove from saved jobs' : 'Save job'}"
            style="font-size:1.1rem;padding:4px 8px;"
          >${isSaved ? '🔖' : '🏷️'}</button>
        </div>
      </div>
      <div class="job-card__badges">
        <span class="badge ${Fmt.statusBadge(job.jobType)}">${Fmt.label(job.jobType)}</span>
        ${job.experienceLevel ? `<span class="badge badge--gray">${Fmt.label(job.experienceLevel)}</span>` : ''}
      </div>
      <div class="job-card__footer">
        <div class="job-card__location"><span aria-hidden="true">📍</span>${escHtml(job.location)}</div>
        <div class="job-card__salary">${Fmt.salary(job.salary)}</div>
      </div>
      <button
        class="btn btn--primary btn--sm btn--full"
        onclick="event.stopPropagation(); applyFromDashboard('${job._id}', '${escHtml(job.title)}', '${escHtml(job.company)}')"
        aria-label="Apply to ${escHtml(job.title)}"
        style="margin-top:var(--space-sm);"
      >
        Apply Now
      </button>
    `;

    // Wire save button
    card.querySelector('.save-job-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSaveJob(job, card.querySelector('.save-job-btn'));
    });

    return card;
  }

  /* ─── Saved Jobs (Seeker) ──────────────────────────────────── */
  function loadSavedJobs() {
    const grid = document.getElementById('saved-jobs-grid');
    const emptyState = document.getElementById('saved-jobs-empty');
    const clearBtn = document.getElementById('clear-saved-btn');
    
    if (!grid) return;
    
    const saved = getSavedJobs();
    
    grid.innerHTML = '';
    
    if (saved.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    if (clearBtn) {
      clearBtn.style.display = 'inline-block';
      clearBtn.onclick = () => {
        if (confirm('Are you sure you want to clear all saved jobs?')) {
          localStorage.setItem('nexus_saved_jobs', JSON.stringify([]));
          loadSavedJobs();
          Toast.success('Saved jobs cleared');
        }
      };
    }
    
    saved.forEach(job => {
      const card = buildDashJobCard(job);
      // Ensure clicks on the card navigate to job details
      card.style.cursor = 'pointer';
      card.onclick = () => window.viewJobDetail(job._id);
      grid.appendChild(card);
    });
  }

  window.applyFromDashboard = (jobId, title, company) => {
    openDashApplyModal(jobId, title, company);
  };

  function openDashApplyModal(jobId, title, company) {
    const applyModal  = document.getElementById('apply-modal-overlay');
    const applyJobId  = document.getElementById('apply-job-id');
    const applyName   = document.getElementById('apply-modal-job-name');
    const coverLetter = document.getElementById('cover-letter');
    const applyError  = document.getElementById('apply-error');
    const applyForm   = document.getElementById('apply-form');
    const applySubmit = document.getElementById('apply-submit-btn');
    const coverCount  = document.getElementById('cover-letter-count');

    if (!applyModal || !applyForm) return;

    if (applyJobId) applyJobId.value = jobId;
    if (applyName) applyName.textContent = `Applying for: ${title} at ${company}`;
    if (coverLetter) coverLetter.value = '';
    if (coverCount) coverCount.textContent = '0 / 5,000 characters';
    if (applyError) applyError.classList.remove('visible');

    // Wire the form (prevent double-wiring)
    if (!applyForm.dataset.wired) {
      applyForm.dataset.wired = 'true';

      coverLetter?.addEventListener('input', () => {
        const len = coverLetter.value.length;
        if (coverCount) coverCount.textContent = `${len.toLocaleString()} / 5,000 characters`;
      });

      document.getElementById('apply-modal-close-btn')?.addEventListener('click', () => {
        applyModal.style.display = 'none';
        document.body.style.overflow = '';
      });

      applyModal.addEventListener('click', (e) => {
        if (e.target === applyModal) {
          applyModal.style.display = 'none';
          document.body.style.overflow = '';
        }
      });

      applyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const curJobId = document.getElementById('apply-job-id')?.value;
        if (!curJobId) return;

        if (applyError) applyError.classList.remove('visible');

        applySubmit.textContent = 'Submitting…';
        applySubmit.classList.add('btn--loading');
        applySubmit.disabled = true;

        try {
          await API.post('/applications', {
            jobId: curJobId,
            coverLetter: coverLetter?.value.trim() ?? '',
          });

          applyModal.style.display = 'none';
          document.body.style.overflow = '';
          Toast.success('Application submitted! 🎉');
          if (typeof window._loadSeekerStats === 'function') await window._loadSeekerStats();

        } catch (err) {
          alert(`Application failed: ${err.message}`);
          if (applyError) {
            applyError.textContent = err.message;
            applyError.classList.add('visible');
          }
        } finally {
          applySubmit.textContent = 'Submit Application';
          applySubmit.classList.remove('btn--loading');
          applySubmit.disabled = false;
        }
      });
    }

    applyModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    coverLetter?.focus();
  }

  /* ═══════════════════════════════════════════════════════════════
     PROFILE (shared)
  ═══════════════════════════════════════════════════════════════ */
  /* ═══════════════════════════════════════════════════════════════
     MY PROFILE — Full Academic Profile
  ═══════════════════════════════════════════════════════════════ */
  async function loadProfile() {
    // ─ fetch fresh data ───────────────────────────────────────────────────
    let user;
    try {
      const data = await API.get('/auth/me');
      user = data.data.user;
      currentUser = user;
      localStorage.setItem('nexus_user', JSON.stringify(user));
    } catch (err) {
      alert(`Failed to load profile: ${err.message}`);
      return;
    }

    const sp = user.seekerProfile    ?? {};
    const rp = user.recruiterProfile ?? {};

    if (role === 'seeker') {
      // ─ Academic fields ──────────────────────────────────────────
      setValue('acad-fullname',  `${user.firstName} ${user.lastName}`);
      setValue('acad-roll',      sp.rollNumber      ?? '');
      setValue('acad-cgpa',      sp.cgpa            ?? '');
      setValue('acad-backlogs',  sp.activeBacklogs   ?? 0);
      setValue('acad-grad-year', sp.graduationYear   ?? '');
      setValue('acad-10th',      sp.percentage10th  ?? '');
      setValue('acad-12th',      sp.percentage12th  ?? '');
      setValue('acad-skills',    (sp.skills ?? []).join(', '));

      // Department dropdown
      const deptEl = document.getElementById('acad-dept');
      if (deptEl) deptEl.value = sp.department ?? '';

      // Resume preview
      const previewBox = document.getElementById('resume-preview-box');
      if (previewBox) {
        if (sp.resume) {
          previewBox.innerHTML = `<a href="${escHtml(sp.resume)}" target="_blank" style="color:var(--primary);font-size:.875rem;">📎 ${escHtml(sp.resume.split('/').pop())}</a>`;
        } else {
          previewBox.innerHTML = '<p class="text-muted" style="font-size:.85rem;margin:0;">No PDF uploaded. Mandatory for applying to active campus jobs.</p>';
        }
      }

      // ─ Dynamic row tables ─────────────────────────────────────────
      renderAddRowTable('projects-body', 'projects-empty-row', sp.projects ?? [], [
        { name: 'title',       placeholder: 'Project Title' },
        { name: 'description', placeholder: 'Brief description' },
        { name: 'techStack',   placeholder: 'React, Node…' },
        { name: 'link',        placeholder: 'https://github.com/…' },
      ]);
      renderAddRowTable('certs-body', 'certs-empty-row', sp.certifications ?? [], [
        { name: 'name',   placeholder: 'Certificate Name' },
        { name: 'issuer', placeholder: 'Issuer / Platform' },
        { name: 'date',   placeholder: 'e.g. Jun 2024' },
        { name: 'link',   placeholder: 'https://…' },
      ]);
      renderAddRowTable('work-body', 'work-empty-row', sp.workExperience ?? [], [
        { name: 'company',     placeholder: 'Company Name' },
        { name: 'role',        placeholder: 'Your Role' },
        { name: 'duration',    placeholder: 'e.g. 3 months' },
        { name: 'description', placeholder: 'Key responsibilities…' },
      ]);

      // ─ Completion bar ──────────────────────────────────────────
      updateCompletionBar(user);

      // ─ Add-row button wiring (once) ───────────────────────────
      wireAddRowBtn('add-project-btn', 'projects-body', 'projects-empty-row', [
        { name: 'title',       placeholder: 'Project Title' },
        { name: 'description', placeholder: 'Brief description' },
        { name: 'techStack',   placeholder: 'React, Node…' },
        { name: 'link',        placeholder: 'https://github.com/…' },
      ]);
      wireAddRowBtn('add-cert-btn', 'certs-body', 'certs-empty-row', [
        { name: 'name',   placeholder: 'Certificate Name' },
        { name: 'issuer', placeholder: 'Issuer / Platform' },
        { name: 'date',   placeholder: 'e.g. Jun 2024' },
        { name: 'link',   placeholder: 'https://…' },
      ]);
      wireAddRowBtn('add-work-btn', 'work-body', 'work-empty-row', [
        { name: 'company',     placeholder: 'Company Name' },
        { name: 'role',        placeholder: 'Your Role' },
        { name: 'duration',    placeholder: 'e.g. 3 months' },
        { name: 'description', placeholder: 'Key responsibilities…' },
      ]);

      // ─ File input display ───────────────────────────────────────
      const fileInput = document.getElementById('resume-file-input');
      const fileDisplay = document.getElementById('file-name-display');
      fileInput?.addEventListener('change', () => {
        fileDisplay.textContent = fileInput.files[0]?.name ?? 'No file chosen';
      });

      // ─ Resume upload button ───────────────
      const resumeBtn = document.getElementById('resume-upload-btn');
      if (resumeBtn && !resumeBtn.dataset.wired) {
        resumeBtn.dataset.wired = 'true';
        resumeBtn.addEventListener('click', async () => {
          const file = fileInput?.files[0];
          if (!file) { alert('Please choose a PDF file first.'); return; }
          
          resumeBtn.textContent = 'Uploading...';
          resumeBtn.classList.add('btn--loading');
          resumeBtn.disabled = true;

          try {
            const formData = new FormData();
            formData.append('resume', file);

            const response = await fetch('/api/v1/auth/upload-resume', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${Auth.getToken()}`
              },
              body: formData
            });

            const data = await response.json();

            if (!response.ok) {
              throw new Error(data.message || 'Upload failed');
            }

            // Update user state
            currentUser = data.data.user;
            localStorage.setItem('nexus_user', JSON.stringify(currentUser));
            
            // Update UI
            const previewBox = document.getElementById('resume-preview-box');
            if (previewBox) {
              previewBox.innerHTML = `<a href="${escHtml(data.data.resumeUrl)}" target="_blank" style="color:var(--primary);font-size:.875rem;">📎 ${escHtml(data.data.resumeUrl.split('/').pop())}</a>`;
            }
            Toast.success('✅ Resume uploaded successfully!');
          } catch (err) {
            alert(`Upload failed: ${err.message}`);
          } finally {
            resumeBtn.textContent = '⬆ Upload PDF Document';
            resumeBtn.classList.remove('btn--loading');
            resumeBtn.disabled = false;
          }
        });
      }

      // ─ Save Complete Profile button ────────────────────────
      const saveFullBtn = document.getElementById('save-full-profile-btn');
      if (saveFullBtn && !saveFullBtn.dataset.wired) {
        saveFullBtn.dataset.wired = 'true';
        saveFullBtn.addEventListener('click', async () => {
          saveFullBtn.textContent = 'Saving…';
          saveFullBtn.classList.add('btn--loading');
          saveFullBtn.disabled = true;

          try {
            const payload = {
              rollNumber:      document.getElementById('acad-roll')?.value.trim(),
              cgpa:            document.getElementById('acad-cgpa')?.value,
              activeBacklogs:  document.getElementById('acad-backlogs')?.value,
              graduationYear:  document.getElementById('acad-grad-year')?.value,
              percentage10th:  document.getElementById('acad-10th')?.value,
              percentage12th:  document.getElementById('acad-12th')?.value,
              department:      document.getElementById('acad-dept')?.value,
              skills:          document.getElementById('acad-skills')?.value,
              projects:        readTableRows('projects-body', ['title','description','techStack','link']),
              certifications:  readTableRows('certs-body',    ['name','issuer','date','link']),
              workExperience:  readTableRows('work-body',     ['company','role','duration','description']),
            };

            const res = await API.patch('/auth/profile', payload);
            currentUser = res.data.user;
            localStorage.setItem('nexus_user', JSON.stringify(currentUser));
            updateCompletionBar(currentUser);
            Toast.success('✅ Profile saved successfully!');
          } catch (err) {
            alert(`Save failed: ${err.message}`);
          } finally {
            saveFullBtn.textContent = '💾 Save Complete Profile';
            saveFullBtn.classList.remove('btn--loading');
            saveFullBtn.disabled = false;
          }
        });
      }

    } else {
      // ─ Recruiter fields (profile form) ───────────────────────
      setValue('profile-first-name',    user.firstName);
      setValue('profile-last-name',     user.lastName);
      setValue('profile-email',         user.email);
      setValue('profile-phone',         user.phone     ?? '');
      setValue('profile-location',      user.location  ?? '');
      setValue('profile-company-name',  rp.companyName ?? '');
      setValue('profile-company-website', rp.companyWebsite ?? '');
      setValue('profile-industry',      rp.industry    ?? '');
      const sizeEl = document.getElementById('profile-company-size');
      if (sizeEl) sizeEl.value = rp.companySize ?? '';
    }

    // Update sidebar
    const fullName = `${user.firstName} ${user.lastName}`;
    if (sidebarName)   sidebarName.textContent   = fullName;
    if (sidebarAvatar) sidebarAvatar.textContent = Fmt.initials(fullName);

    // ─ Recruiter profile form (already exists in HTML) ────────────
    const form    = document.getElementById('profile-form');
    const saveBtn = document.getElementById('profile-save-btn');
    if (form && saveBtn && !form.dataset.wired) {
      form.dataset.wired = 'true';
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        saveBtn.textContent = 'Saving…';
        saveBtn.classList.add('btn--loading');
        saveBtn.disabled = true;
        try {
          const payload = {
            firstName:          document.getElementById('profile-first-name')?.value.trim(),
            lastName:           document.getElementById('profile-last-name')?.value.trim(),
            phone:              document.getElementById('profile-phone')?.value.trim()    || undefined,
            location:           document.getElementById('profile-location')?.value.trim() || undefined,
            companyName:        document.getElementById('profile-company-name')?.value.trim(),
            companyWebsite:     document.getElementById('profile-company-website')?.value.trim(),
            industry:           document.getElementById('profile-industry')?.value.trim(),
            companySize:        document.getElementById('profile-company-size')?.value,
          };
          const res = await API.patch('/auth/profile', payload);
          currentUser = res.data.user;
          localStorage.setItem('nexus_user', JSON.stringify(currentUser));
          Toast.success('✅ Company profile saved!');
          const fn = `${payload.firstName} ${payload.lastName}`;
          if (sidebarName)   sidebarName.textContent   = fn;
          if (sidebarAvatar) sidebarAvatar.textContent = Fmt.initials(fn);
        } catch (err) {
          alert(`Save failed: ${err.message}`);
        } finally {
          saveBtn.textContent = '💾 Save Company Profile';
          saveBtn.classList.remove('btn--loading');
          saveBtn.disabled = false;
        }
      });
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     PROFILE HELPERS
     ───────────────────────────────────────────────────────────────── */

  /** Render pre-existing rows into an add-row table */
  function renderAddRowTable(tbodyId, emptyRowId, data, cols) {
    const tbody    = document.getElementById(tbodyId);
    const emptyRow = document.getElementById(emptyRowId);
    if (!tbody) return;

    // Remove all existing data rows (keep empty row)
    tbody.querySelectorAll('tr.addrow-data-row').forEach(r => r.remove());

    if (!data.length) {
      if (emptyRow) emptyRow.style.display = '';
      return;
    }
    if (emptyRow) emptyRow.style.display = 'none';

    data.forEach((item) => {
      tbody.insertBefore(buildAddRow(cols, item), emptyRow);
    });
  }

  /** Wire an "+ Add Row" button */
  function wireAddRowBtn(btnId, tbodyId, emptyRowId, cols) {
    const btn = document.getElementById(btnId);
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = 'true';
    btn.addEventListener('click', () => {
      const tbody    = document.getElementById(tbodyId);
      const emptyRow = document.getElementById(emptyRowId);
      if (!tbody) return;
      if (emptyRow) emptyRow.style.display = 'none';
      tbody.insertBefore(buildAddRow(cols, {}), emptyRow);
    });
  }

  /** Build a single editable table row */
  function buildAddRow(cols, defaults = {}) {
    const tr = document.createElement('tr');
    tr.className = 'addrow-data-row';

    cols.forEach(({ name, placeholder }) => {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type        = 'text';
      inp.placeholder = placeholder ?? '';
      inp.value       = defaults[name] ?? '';
      inp.dataset.col = name;
      td.appendChild(inp);
      tr.appendChild(td);
    });

    // Delete button cell
    const delTd  = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.type      = 'button';
    delBtn.className = 'addrow-del-btn';
    delBtn.title     = 'Delete row';
    delBtn.innerHTML = '✕';
    delBtn.addEventListener('click', () => {
      const tbody    = tr.parentElement;
      const emptyId  = tbody?.id.replace('-body', '-empty-row');
      tr.remove();
      if (tbody && !tbody.querySelectorAll('tr.addrow-data-row').length) {
        const emptyRow = document.getElementById(emptyId);
        if (emptyRow) emptyRow.style.display = '';
      }
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);
    return tr;
  }

  /** Read all data rows from a table body into an array of objects */
  function readTableRows(tbodyId, colNames) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return [];
    const rows = tbody.querySelectorAll('tr.addrow-data-row');
    return Array.from(rows).map((tr) => {
      const obj = {};
      colNames.forEach((col) => {
        const inp = tr.querySelector(`input[data-col="${col}"]`);
        obj[col] = inp?.value.trim() ?? '';
      });
      return obj;
    }).filter(obj => Object.values(obj).some(v => v.length > 0));
  }

  /** Update the profile completion bar for seekers */
  function updateCompletionBar(user) {
    const fillEl = document.getElementById('completion-fill');
    const pctEl  = document.getElementById('completion-pct');
    if (!fillEl || !pctEl) return;

    const sp = user.seekerProfile ?? {};
    const checks = [
      !!user.firstName && !!user.lastName,         // name
      !!(user.phone || user.location),              // contact
      !!(sp.cgpa),                                  // CGPA
      !!(sp.rollNumber),                            // roll number
      !!(sp.department),                            // department
      !!(sp.graduationYear),                        // grad year
      !!(sp.skills?.length),                        // skills
      !!(sp.resume),                                // resume
      !!(sp.projects?.length),                      // projects
      !!(sp.certifications?.length),                // certs
    ];
    const pct = Math.round((checks.filter(Boolean).length / checks.length) * 100);
    fillEl.style.width = `${pct}%`;
    pctEl.textContent  = `${pct}%`;
  }



  /* ═══════════════════════════════════════════════════════════════
     AI RESUME SCORE
  ═══════════════════════════════════════════════════════════════ */
  function loadAiScore() {
    const user = currentUser;
    if (!user) return;
    const sp = user.seekerProfile ?? {};

    // Calculate category scores from profile data
    const categories = [
      { name: 'Contact Info',    score: (!!(user.phone) + !!(user.location)) / 2 * 100 },
      { name: 'Academic Info',   score: [sp.cgpa,sp.rollNumber,sp.department,sp.graduationYear,sp.percentage10th,sp.percentage12th].filter(Boolean).length / 6 * 100 },
      { name: 'Skills',          score: Math.min((sp.skills?.length ?? 0) * 10, 100) },
      { name: 'Projects',        score: Math.min((sp.projects?.length ?? 0) * 25, 100) },
      { name: 'Certifications',  score: Math.min((sp.certifications?.length ?? 0) * 33, 100) },
      { name: 'Work Experience', score: Math.min((sp.workExperience?.length ?? 0) * 50, 100) },
      { name: 'Resume PDF',      score: sp.resume ? 100 : 0 },
    ];

    const totalScore = Math.round(categories.reduce((s, c) => s + c.score, 0) / categories.length);

    // Animate score ring (circumference of r=52 is 326.73)
    const CIRCUM = 326.73;
    const ringFill = document.getElementById('score-ring-fill');
    const scoreNum  = document.getElementById('ai-score-number');
    const scoreGrade = document.getElementById('ai-score-grade');
    setTimeout(() => {
      if (ringFill) ringFill.style.strokeDashoffset = String(CIRCUM - (CIRCUM * totalScore / 100));
      if (scoreNum)  scoreNum.textContent  = String(totalScore);
      if (scoreGrade) {
        const grades = [[85,'Excellent 🌟'],[70,'Good 👍'],[50,'Average ⚠️'],[0,'Needs Work 🛠️']];
        scoreGrade.textContent = grades.find(([min]) => totalScore >= min)?.[1] ?? 'N/A';
      }
    }, 100);

    // Category bars
    const catContainer = document.getElementById('ai-score-categories');
    if (catContainer) {
      catContainer.innerHTML = categories.map(c => `
        <div class="score-category">
          <div class="score-category__header">
            <span class="score-category__name">${escHtml(c.name)}</span>
            <span class="score-category__value">${Math.round(c.score)}%</span>
          </div>
          <div class="score-category__track">
            <div class="score-category__bar" style="width:0%" data-target="${Math.round(c.score)}"></div>
          </div>
        </div>`).join('');

      // Animate bars
      setTimeout(() => {
        catContainer.querySelectorAll('.score-category__bar').forEach(bar => {
          bar.style.width = bar.dataset.target + '%';
        });
      }, 200);
    }

    // Tips
    const tips = [];
    if (!sp.resume)                     tips.push('Upload your resume PDF to be eligible for campus applications.');
    if ((sp.skills?.length ?? 0) < 5)   tips.push('Add at least 5 relevant skills to improve recruiter visibility.');
    if (!(sp.projects?.length))         tips.push('Add at least 1 academic or personal project to stand out.');
    if (!(sp.certifications?.length))   tips.push('Earn certifications on Coursera/LinkedIn to boost credibility.');
    if (!sp.cgpa)                       tips.push('Fill in your CGPA in the Academic Information section.');
    if (!user.phone || !user.location)  tips.push('Complete your contact info (phone and location).');
    if (!(sp.workExperience?.length))   tips.push('Add any internship or part-time experience, even brief ones.');
    if (tips.length === 0)              tips.push('Great job! Your profile is comprehensive. Keep updating it.');

    const tipsList = document.getElementById('ai-tips-list');
    if (tipsList) tipsList.innerHTML = tips.map(t => `<li>${escHtml(t)}</li>`).join('');
  }


  /* ═══════════════════════════════════════════════════════════════
     PLACEMENT PREDICTOR
  ═══════════════════════════════════════════════════════════════ */
  function initPredictor() {
    const ALL_COMPANIES = [
      { name: 'Google',        minScore: 88 },
      { name: 'Microsoft',     minScore: 82 },
      { name: 'Amazon',        minScore: 78 },
      { name: 'Meta',          minScore: 85 },
      { name: 'Infosys',       minScore: 55 },
      { name: 'TCS',           minScore: 50 },
      { name: 'Wipro',         minScore: 48 },
      { name: 'Accenture',     minScore: 52 },
      { name: 'HCL',           minScore: 45 },
      { name: 'Deloitte',      minScore: 65 },
      { name: 'IBM',           minScore: 60 },
      { name: 'Cognizant',     minScore: 50 },
    ];

    const sliders = [
      { id: 'slider-cgpa',     valId: 'slider-cgpa-val',     weight: 35, max: 10   },
      { id: 'slider-projects', valId: 'slider-projects-val', weight: 20, max: 20   },
      { id: 'slider-certs',    valId: 'slider-certs-val',    weight: 15, max: 20   },
      { id: 'slider-skills',   valId: 'slider-skills-val',   weight: 20, max: 30   },
      { id: 'slider-exp',      valId: 'slider-exp-val',      weight: 10, max: 24   },
    ];

    // Prefill sliders from profile
    const sp = currentUser?.seekerProfile ?? {};
    const cgpaEl     = document.getElementById('slider-cgpa');
    const projectsEl = document.getElementById('slider-projects');
    const certsEl    = document.getElementById('slider-certs');
    const skillsEl   = document.getElementById('slider-skills');
    if (cgpaEl     && sp.cgpa)                    cgpaEl.value     = sp.cgpa;
    if (projectsEl && sp.projects?.length)        projectsEl.value = sp.projects.length;
    if (certsEl    && sp.certifications?.length)  certsEl.value    = sp.certifications.length;
    if (skillsEl   && sp.skills?.length)          skillsEl.value   = sp.skills.length;

    function calcScore() {
      let total = 0;
      sliders.forEach(({ id, weight, max }) => {
        const el = document.getElementById(id);
        if (!el) return;
        total += (parseFloat(el.value) / max) * weight;
      });
      return Math.min(Math.round(total), 100);
    }

    function updateDisplay() {
      sliders.forEach(({ id, valId }) => {
        const el  = document.getElementById(id);
        const val = document.getElementById(valId);
        if (el && val) val.textContent = el.value;
      });

      const score = calcScore();

      const gauge = document.getElementById('prob-gauge-fill');
      const pct   = document.getElementById('prob-pct');
      if (gauge) gauge.style.height = `${score}%`;
      if (pct)   pct.textContent   = `${score}%`;

      const matchList = document.getElementById('company-match-list');
      if (matchList) {
        const matches = ALL_COMPANIES
          .filter(c => score >= c.minScore)
          .map(c => `<li><span class="match-name">${escHtml(c.name)}</span><span class="match-pct">${Math.min(Math.round((score - c.minScore + 10) * 2), 99)}% match</span></li>`);
        matchList.innerHTML = matches.length
          ? matches.join('')
          : '<li><span style="color:var(--text-secondary);font-size:.85rem;">Improve your profile score to unlock company matches.</span></li>';
      }
    }

    // Wire sliders (only once)
    sliders.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el && !el.dataset.wired) {
        el.dataset.wired = 'true';
        el.addEventListener('input', updateDisplay);
      }
    });

    updateDisplay();
  }


  /* ═══════════════════════════════════════════════════════════════
     CHAT & BOARD
  ═══════════════════════════════════════════════════════════════ */
  function loadChatBoard() {
    // Announcements
    const announcements = [
      { icon: '🎉', title: 'Placement Season 2025 Open!', desc: 'Over 120 companies registered for the upcoming campus drive. Update your profiles now.', date: 'Jun 20, 2025' },
      { icon: '⚠️',  title: 'Deadline Reminder',         desc: 'Resume submission deadline for Tier-1 companies is June 28. Ensure your PDF is uploaded.', date: 'Jun 18, 2025' },
      { icon: '🏢', title: 'New Company Added',          desc: 'Deloitte UST has been added to the placement portal. Eligible students can apply now.', date: 'Jun 15, 2025' },
    ];

    const annList = document.getElementById('announcement-list');
    if (annList) {
      annList.innerHTML = announcements.map(a => `
        <div class="announcement-card">
          <div class="announcement-card__icon">${a.icon}</div>
          <div class="announcement-card__body">
            <div class="announcement-card__title">${escHtml(a.title)}</div>
            <div class="announcement-card__desc">${escHtml(a.desc)}</div>
            <div class="announcement-card__date">${escHtml(a.date)}</div>
          </div>
        </div>`).join('');
    }

    // Career Tips
    const tips = [
      { tip: '<strong>CGPA matters… but not everything.</strong> Focus on projects and internships to differentiate yourself from equally-scored candidates.' },
      { tip: '<strong>Tailor your resume.</strong> Use keywords from each job description. ATS filters reject 75% of resumes before a human reads them.' },
      { tip: '<strong>Practice DSA daily.</strong> Spend 30 minutes on LeetCode. Even easy/medium questions consistently solved make a big difference.' },
      { tip: '<strong>Network early.</strong> Connect with alumni on LinkedIn. A referral can multiply your interview chances by 5x.' },
    ];

    const tipsFeed = document.getElementById('tips-feed');
    if (tipsFeed) {
      tipsFeed.innerHTML = tips.map(t => `<div class="tip-card">${t.tip}</div>`).join('');
    }

    // Events
    const events = [
      { day: '28', month: 'Jun', title: 'Mock Aptitude Test — Round 1', meta: ['📍 Online', '⏰ 10:00 AM'] },
      { day: '05', month: 'Jul', title: 'Google Pre-Placement Talk',    meta: ['🏢 Auditorium A', '⏰ 2:00 PM'] },
      { day: '12', month: 'Jul', title: 'Resume Review Workshop',        meta: ['📍 Virtual (Zoom)', '⏰ 11:00 AM'] },
      { day: '20', month: 'Jul', title: 'Campus Drive — TCS',           meta: ['🏢 Hall 3', '⏰ 9:00 AM'] },
    ];

    const eventsList = document.getElementById('events-list');
    if (eventsList) {
      eventsList.innerHTML = events.map(ev => `
        <div class="event-item">
          <div class="event-date-box">
            <div class="event-date-box__day">${escHtml(ev.day)}</div>
            <div class="event-date-box__month">${escHtml(ev.month)}</div>
          </div>
          <div class="event-info">
            <div class="event-info__title">${escHtml(ev.title)}</div>
            <div class="event-info__meta">${ev.meta.map(m => `<span>${escHtml(m)}</span>`).join('')}</div>
          </div>
        </div>`).join('');
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     GLOBAL HELPERS (also exposed to inline table onclick handlers)
  ═══════════════════════════════════════════════════════════════ */
  window.switchView = switchView;
  window.highlightNavGlobal = highlightNav;

  // Expose stats loaders immediately so handlePostJobSubmit & applyFromDashboard
  // can always call them (those run on window, outside this closure)
  window._loadSeekerStats   = loadSeekerStats;
  window._loadRecruiterStats = loadRecruiterStats;

  window.loadApplicantsForJob = async (jobId) => {
    // Navigate to the applicants view and pre-filter by the given job
    await switchView('applicants');
    highlightNav('nav-applicants');
    const select = document.getElementById('applicants-job-filter');
    if (select) select.value = jobId;
    await fetchApplicantsForJob(jobId, '');
  };

  window.viewJobDetail = (jobId) => {
    window.open(`/index.html#job-${jobId}`, '_blank');
  };

  /** Escape HTML to prevent XSS in dynamically built table rows */
  function escHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Safely set a form input's value */
  function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
  }

  /** Set an element's textContent safely */
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? '0');
  }

  /** Set a field error message */
  function setFieldError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('visible', !!message);
  }

  /* ═══════════════════════════════════════════════════════════════
     JOB ALERTS (Seeker)
  ═══════════════════════════════════════════════════════════════ */
  async function loadAlerts() {
    const list = document.getElementById('alerts-list');
    const emptyState = document.getElementById('alerts-empty');
    if (!list) return;

    try {
      const res = await API.get('/alerts');
      const alerts = res.data || [];

      if (alerts.length === 0) {
        list.innerHTML = '';
        list.style.display = 'none';
        emptyState.style.display = 'block';
        return;
      }

      emptyState.style.display = 'none';
      list.style.display = 'flex';

      list.innerHTML = alerts.map(alert => `
        <div class="job-card" style="display:flex; justify-content:space-between; align-items:center; cursor:default;">
          <div>
            <h4 style="margin:0; font-size:1.1rem; color:var(--text);">${escHtml(alert.keyword)}</h4>
            <div style="color:var(--text-muted); font-size:0.9rem; margin-top:4px;">
              📍 ${escHtml(alert.location) || 'Any Location'}
            </div>
          </div>
          <button class="btn btn--outline btn--sm" onclick="window.deleteAlert('${alert._id}')">Delete</button>
        </div>
      `).join('');
    } catch (err) {
      console.error('Failed to load alerts', err);
      Toast.error('Could not load your job alerts.');
    }
  }

  const createAlertForm = document.getElementById('create-alert-form');
  if (createAlertForm) {
    createAlertForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const keyword = document.getElementById('alert-keyword').value.trim();
      const location = document.getElementById('alert-location').value.trim();
      const btn = document.getElementById('alert-submit-btn');

      try {
        btn.disabled = true;
        btn.textContent = 'Creating...';
        await API.post('/alerts', { keyword, location });
        Toast.success('Job alert created successfully!');
        createAlertForm.reset();
        await loadAlerts();
      } catch (err) {
        Toast.error(err.message || 'Failed to create job alert.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create Alert';
      }
    });
  }

  window.deleteAlert = async (id) => {
    if (!confirm('Are you sure you want to delete this alert?')) return;
    try {
      await API.delete('/alerts/' + id);
      Toast.success('Job alert deleted.');
      await loadAlerts();
    } catch (err) {
      Toast.error('Failed to delete job alert.');
    }
  };

  /* ═══════════════════════════════════════════════════════════════
     INTERVIEW SCHEDULING (Both Roles)
  ═══════════════════════════════════════════════════════════════ */
  async function loadInterviews() {
    const container = document.getElementById('interviews-container');
    if (!container) return;
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-md);">Loading interviews…</p>';

    try {
      const data = await API.get('/interviews/my');
      const interviews = data.data || [];

      // Update badge
      const badgeS = document.getElementById('badge-interviews');
      const badgeR = document.getElementById('badge-recruiter-interviews');
      if (badgeS) badgeS.textContent = String(interviews.length);
      if (badgeR) badgeR.textContent = String(interviews.length);

      if (!interviews.length) {
        container.innerHTML = `
          <div class="interview-empty" style="text-align:center; padding:var(--space-xl); color:var(--text-muted);">
            <div style="font-size:2.5rem;margin-bottom:var(--space-md);">📅</div>
            <p>No interviews found.</p>
          </div>`;
        return;
      }

      container.innerHTML = interviews.map(i => {
        const otherParty = role === 'seeker' ? i.recruiterId : i.applicantId;
        const otherPartyName = otherParty ? `${otherParty.firstName} ${otherParty.lastName}` : 'Unknown';
        
        let actionsHtml = '';
        if (role === 'seeker' && i.status === 'pending') {
          const slotsHtml = i.proposedTimes.map((time, idx) => `
            <button class="btn btn--outline btn--sm" onclick="window.acceptInterview('${i._id}', '${time}')" style="margin-right:var(--space-xs); margin-bottom:var(--space-xs);">
              Accept: ${Fmt.date(time)} ${new Date(time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </button>
          `).join('');
          actionsHtml = `
            <div style="margin-top:var(--space-sm);">
              <p style="font-size:0.9rem; margin-bottom:var(--space-xs);"><strong>Select a time slot:</strong></p>
              ${slotsHtml}
              <button class="btn btn--danger btn--sm" onclick="window.rejectInterview('${i._id}')">Reject</button>
            </div>
          `;
        }

        let timeHtml = `<span style="color:var(--warning);">Pending Candidate Selection</span>`;
        if (i.status === 'scheduled') {
          timeHtml = `<strong>Scheduled for:</strong> ${Fmt.date(i.scheduledTime)} ${new Date(i.scheduledTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
        } else if (i.status === 'completed') {
          timeHtml = `<strong>Completed</strong>`;
        } else if (i.status === 'cancelled' || i.status === 'rejected') {
          timeHtml = `<strong style="color:var(--danger);">Cancelled/Rejected</strong>`;
        }

        return `
          <div class="job-card" style="cursor:default; margin-bottom:var(--space-md);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <div>
                <h3 style="margin:0; font-size:1.1rem;">${escHtml(i.jobId?.title || 'Unknown Job')}</h3>
                <p style="color:var(--text-secondary); font-size:0.9rem; margin:var(--space-xs) 0;">
                  ${role === 'seeker' ? 'Recruiter: ' : 'Candidate: '} <strong>${escHtml(otherPartyName)}</strong>
                </p>
                <p style="color:var(--text-secondary); font-size:0.9rem;">
                  ${timeHtml}
                </p>
                ${i.meetingLink ? `<p style="font-size:0.9rem; margin-top:var(--space-xs);"><strong>Meeting Link:</strong> <a href="${escHtml(i.meetingLink)}" target="_blank" style="color:var(--primary);">${escHtml(i.meetingLink)}</a></p>` : ''}
              </div>
              <span class="badge ${Fmt.statusBadge(i.status)}">${Fmt.label(i.status)}</span>
            </div>
            ${actionsHtml}
          </div>
        `;
      }).join('');

    } catch (err) {
      container.innerHTML = `<div class="auth-alert auth-alert--error visible">Failed to load interviews: ${escHtml(err.message)}</div>`;
    }
  }

  // Seeker Actions
  window.acceptInterview = async (interviewId, scheduledTime) => {
    if (!confirm('Are you sure you want to accept this time slot?')) return;
    try {
      await API.patch(`/interviews/${interviewId}`, { status: 'scheduled', scheduledTime });
      Toast.success('Interview scheduled!');
      await loadInterviews();
    } catch (err) {
      Toast.error('Failed to schedule interview: ' + err.message);
    }
  };

  window.rejectInterview = async (interviewId) => {
    if (!confirm('Are you sure you want to decline this interview?')) return;
    try {
      await API.patch(`/interviews/${interviewId}`, { status: 'rejected' });
      Toast.success('Interview declined.');
      await loadInterviews();
    } catch (err) {
      Toast.error('Failed to decline interview: ' + err.message);
    }
  };

  // Recruiter Schedule Modal
  const scheduleModalOverlay = document.getElementById('schedule-modal-overlay');
  const scheduleModalClose   = document.getElementById('schedule-modal-close');
  const scheduleForm         = document.getElementById('schedule-interview-form');
  const scheduleError        = document.getElementById('schedule-modal-error');
  const scheduleSubmitBtn    = document.getElementById('schedule-modal-submit-btn');

  function closeScheduleModal() {
    if (scheduleModalOverlay) {
      scheduleModalOverlay.classList.remove('open');
      document.body.style.overflow = '';
    }
    if (scheduleForm) scheduleForm.reset();
    if (scheduleError) {
      scheduleError.textContent = '';
      scheduleError.classList.remove('visible');
    }
  }

  scheduleModalClose?.addEventListener('click', closeScheduleModal);
  scheduleModalOverlay?.addEventListener('click', (e) => {
    if (e.target === scheduleModalOverlay) closeScheduleModal();
  });

  window.openScheduleModal = (applicationId, applicantName) => {
    const overlay = document.getElementById('schedule-modal-overlay');
    if (!overlay) {
      alert("Modal overlay not found in DOM!");
      return;
    }
    document.getElementById('schedule-application-id').value = applicationId;
    document.getElementById('schedule-modal-applicant').textContent = `Scheduling interview for: ${applicantName}`;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  scheduleForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (scheduleError) {
      scheduleError.textContent = '';
      scheduleError.classList.remove('visible');
    }

    const applicationId = document.getElementById('schedule-application-id').value;
    const time1 = document.getElementById('schedule-time-1').value;
    const time2 = document.getElementById('schedule-time-2').value;
    const time3 = document.getElementById('schedule-time-3').value;
    const meetingLink = document.getElementById('schedule-meeting-link').value;
    const notes = document.getElementById('schedule-notes').value;

    const proposedTimes = [time1, time2, time3].filter(t => t);
    if (proposedTimes.length === 0) {
      scheduleError.textContent = 'Please provide at least one proposed time.';
      scheduleError.classList.add('visible');
      return;
    }

    try {
      scheduleSubmitBtn.textContent = 'Sending...';
      scheduleSubmitBtn.disabled = true;

      await API.post('/interviews', {
        applicationId,
        proposedTimes,
        meetingLink,
        notes
      });

      Toast.success('Interview request sent!');
      closeScheduleModal();
    } catch (err) {
      scheduleError.textContent = err.message || 'Failed to send interview request.';
      scheduleError.classList.add('visible');
    } finally {
      scheduleSubmitBtn.textContent = 'Send Interview Request';
      scheduleSubmitBtn.disabled = false;
    }
  });


  // ── 7. Load the default view (overview) ────────────────────────────────────
  switchView('overview'); // Do not await so we don't block the rest of initialization!

});
