/**
 * jobs.js — Landing page (index.html) job listing logic
 *
 * Depends on: api.js (loaded first via <script>)
 *
 * Responsibilities:
 *  - Fetch GET /api/v1/jobs and render cards into #jobs-grid
 *  - Search form wiring (keyword + location)
 *  - Filter tag clicks
 *  - Sort selector
 *  - Load More / pagination
 *  - Job card click → open detail modal
 *  - Apply Now → open apply form modal
 *  - POST /api/v1/applications submission
 *  - Render skeleton loaders while fetching
 */

document.addEventListener('DOMContentLoaded', () => {

  // ── State ──────────────────────────────────────────────────────────────────
  let currentPage   = 1;
  let totalPages    = 1;
  let activeFilters = {};    // { keyword, location, sort, category, jobType, locationType }
  let selectedJobId = null;  // For the apply modal

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const grid          = document.getElementById('jobs-grid');
  const resultCount   = document.getElementById('jobs-result-count');
  const sortSelect    = document.getElementById('sort-select');
  const searchForm    = document.getElementById('search-form');
  const kwInput       = document.getElementById('search-keyword');
  const locInput      = document.getElementById('search-location');
  const loadMoreBtn   = document.getElementById('load-more-btn');
  const loadMoreWrap  = document.getElementById('load-more-wrapper');
  const paginationInfo = document.getElementById('pagination-info');
  const filterTags    = document.querySelectorAll('.filter-tag');

  // Job detail modal
  const jobModal      = document.getElementById('job-modal-overlay');
  const jobModalClose = document.getElementById('modal-close-btn');
  const modalTitle    = document.getElementById('modal-job-title');
  const modalCompany  = document.getElementById('modal-company-name');
  const modalBadges   = document.getElementById('modal-badges');
  const modalDesc     = document.getElementById('modal-job-description');
  const modalMeta     = document.getElementById('modal-job-meta');
  const modalApplyBtn = document.getElementById('modal-apply-btn');
  const modalSaveBtn  = document.getElementById('modal-save-btn');

  // Apply modal
  const applyModal      = document.getElementById('apply-modal-overlay');
  const applyModalClose = document.getElementById('apply-modal-close-btn');
  const applyForm       = document.getElementById('apply-form');
  const applyJobIdInput = document.getElementById('apply-job-id');
  const applyJobName    = document.getElementById('apply-modal-job-name');
  const coverLetterEl   = document.getElementById('cover-letter');
  const coverCount      = document.getElementById('cover-letter-count');
  const applySubmitBtn  = document.getElementById('apply-submit-btn');
  const applyError      = document.getElementById('apply-error');

  /* ═══════════════════════════════════════════════════════════════
     JOB FETCHING & RENDERING
  ═══════════════════════════════════════════════════════════════ */

  /**
   * Fetch jobs from the API with the given query params.
   * On first load, skeletons are already in the DOM so we just
   * replace them. On "load more" we append new cards.
   */
  const fetchJobs = async (params = {}, append = false) => {
    if (!append) {
      showSkeletons();
    } else {
      loadMoreBtn.textContent = 'Loading…';
      loadMoreBtn.disabled = true;
    }

    try {
      const data = await API.get('/jobs', { ...params, limit: 9 });

      const jobs      = data.data.jobs ?? [];
      const pagination = data.pagination ?? {};

      totalPages = pagination.totalPages ?? 1;

      if (!append) {
        grid.innerHTML = ''; // Clear skeletons
      }

      if (jobs.length === 0 && !append) {
        grid.innerHTML = `
          <div class="jobs-empty-state">
            <div class="jobs-empty-state__icon">🔍</div>
            <h3>No jobs found</h3>
            <p>Try adjusting your search terms or filters.</p>
          </div>`;
        loadMoreWrap.style.display = 'none';
        if (resultCount) resultCount.textContent = '0 jobs found';
        return;
      }

      // Render each job card
      jobs.forEach((job) => {
        const card = buildJobCard(job);
        grid.appendChild(card);
      });

      // Update result count
      if (resultCount) {
        const total = pagination.total ?? jobs.length;
        resultCount.textContent = `${total.toLocaleString()} job${total !== 1 ? 's' : ''} found`;
      }

      // Update pagination
      const hasMore = currentPage < totalPages;
      loadMoreWrap.style.display = hasMore ? 'block' : 'none';
      if (paginationInfo) {
        paginationInfo.textContent = hasMore
          ? `Showing ${grid.querySelectorAll('.job-card:not(.job-card--skeleton)').length} of ${pagination.total ?? '?'}`
          : '';
      }

    } catch (err) {
      // alert() as required by the spec
      alert(`Failed to load jobs: ${err.message}`);
      if (!append) {
        grid.innerHTML = `
          <div class="jobs-empty-state">
            <div class="jobs-empty-state__icon">⚠️</div>
            <h3>Could not load jobs</h3>
            <p>${err.message}</p>
          </div>`;
      }
    } finally {
      if (append) {
        loadMoreBtn.textContent = 'Load More Jobs';
        loadMoreBtn.disabled = false;
      }
    }
  };

  /** Build a single .job-card DOM element from a job object */
  const buildJobCard = (job) => {
    const card = document.createElement('article');
    card.className = 'job-card';
    card.setAttribute('data-job-id', job._id);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${job.title} at ${job.company}`);

    const skillsHtml = (job.skills ?? [])
      .slice(0, 3)
      .map((s) => `<span class="badge badge--gray">${s}</span>`)
      .join('');
    const moreSkills = (job.skills?.length ?? 0) > 3
      ? `<span class="badge badge--gray">+${job.skills.length - 3}</span>` : '';

    const emoji = getCompanyEmoji(job.company);

    card.innerHTML = `
      <div class="job-card__header">
        <div class="job-card__company-logo" aria-hidden="true">${emoji}</div>
        <div class="job-card__meta">
          <div class="job-card__company">${escHtml(job.company)}</div>
          <h3 class="job-card__title">${escHtml(job.title)}</h3>
        </div>
      </div>

      <div class="job-card__badges">
        <span class="badge ${Fmt.statusBadge(job.jobType)}">${Fmt.label(job.jobType)}</span>
        <span class="badge ${Fmt.statusBadge(job.locationType)}">${Fmt.label(job.locationType)}</span>
        ${job.experienceLevel ? `<span class="badge badge--gray">${Fmt.label(job.experienceLevel)}</span>` : ''}
      </div>

      ${skillsHtml || moreSkills ? `
        <div class="job-card__badges" style="margin-top:-var(--space-xs);">
          ${skillsHtml}${moreSkills}
        </div>` : ''}

      <div class="job-card__footer">
        <div class="job-card__location">
          <span aria-hidden="true">📍</span>
          ${escHtml(job.location)}
        </div>
        <div class="job-card__salary">${Fmt.salary(job.salary)}</div>
      </div>

      <div class="job-card__footer" style="padding-top:0; border-top:none; margin-top:-var(--space-sm);">
        <div class="job-card__posted">Posted ${Fmt.date(job.createdAt)}</div>
        ${job.applicationDeadline
          ? `<span class="badge badge--amber" style="font-size:0.7rem;">
               Closes ${Fmt.date(job.applicationDeadline)}
             </span>`
          : ''}
      </div>
    `;

    // Open modal on click or Enter/Space key
    const openModal = () => openJobModal(job);
    card.addEventListener('click', openModal);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(); }
    });

    return card;
  };

  /** Replace grid with animated skeleton loaders */
  const showSkeletons = () => {
    grid.innerHTML = Array.from({ length: 6 }, () => `
      <article class="job-card job-card--skeleton" aria-hidden="true">
        <div style="display:flex;gap:12px;margin-bottom:12px;">
          <div class="skeleton-line" style="width:48px;height:48px;border-radius:12px;flex-shrink:0;"></div>
          <div style="flex:1;">
            <div class="skeleton-line short"></div>
            <div class="skeleton-line wide" style="margin-top:6px;"></div>
          </div>
        </div>
        <div class="skeleton-line mid"></div>
        <div class="skeleton-line short" style="margin-top:auto;"></div>
      </article>
    `).join('');
  };

  /* ═══════════════════════════════════════════════════════════════
     JOB DETAIL MODAL
  ═══════════════════════════════════════════════════════════════ */

  const openJobModal = (job) => {
    selectedJobId = job._id;

    if (modalTitle)   modalTitle.textContent   = job.title;
    if (modalCompany) modalCompany.textContent = `${job.company} · ${job.location}`;

    if (modalBadges) {
      modalBadges.innerHTML = [
        `<span class="badge ${Fmt.statusBadge(job.jobType)}">${Fmt.label(job.jobType)}</span>`,
        `<span class="badge ${Fmt.statusBadge(job.locationType)}">${Fmt.label(job.locationType)}</span>`,
        job.experienceLevel ? `<span class="badge badge--gray">${Fmt.label(job.experienceLevel)}</span>` : '',
        job.category ? `<span class="badge badge--blue">${escHtml(job.category)}</span>` : '',
      ].join('');
    }

    if (modalDesc) {
      // Preserve line breaks from description
      modalDesc.innerHTML = escHtml(job.description).replace(/\n/g, '<br />');
    }

    if (modalMeta) {
      const metaItems = [
        ['💰 Salary',   Fmt.salary(job.salary)],
        ['📍 Location', `${job.location} (${Fmt.label(job.locationType)})`],
        ['📆 Posted',   Fmt.date(job.createdAt)],
        job.applicationDeadline
          ? ['⏰ Deadline', Fmt.date(job.applicationDeadline)]
          : null,
        job.skills?.length
          ? ['🛠 Skills', (job.skills).join(', ')]
          : null,
      ].filter(Boolean);

      modalMeta.innerHTML = metaItems.map(([label, value]) => `
        <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:var(--space-md);">
          <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">${label}</div>
          <div style="font-size:0.875rem; color:var(--text-primary); font-weight:500;">${escHtml(String(value))}</div>
        </div>
      `).join('');
    }

    // If logged in as seeker: show Apply Now. Otherwise: redirect to login.
    if (modalApplyBtn) {
      const isSeeker = Auth.isAuthenticated() && Auth.getRole() === 'seeker';
      const isAuth   = Auth.isAuthenticated();

      if (isSeeker) {
        modalApplyBtn.textContent = 'Apply Now';
        modalApplyBtn.disabled = false;
        modalApplyBtn.onclick = () => {
          closeJobModal();
          openApplyModal(job);
        };
      } else if (!isAuth) {
        modalApplyBtn.textContent = 'Log In to Apply';
        modalApplyBtn.onclick = () => { window.location.href = '/login.html'; };
      } else {
        // recruiter
        modalApplyBtn.textContent = 'View on Dashboard';
        modalApplyBtn.onclick = () => { window.location.href = '/dashboard.html'; };
      }
    }

    // Open the modal
    jobModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    modalTitle?.focus();
  };

  const closeJobModal = () => {
    jobModal.classList.remove('open');
    document.body.style.overflow = '';
    selectedJobId = null;
  };

  jobModalClose?.addEventListener('click', closeJobModal);
  jobModal?.addEventListener('click', (e) => { if (e.target === jobModal) closeJobModal(); });

  /* ═══════════════════════════════════════════════════════════════
     APPLY MODAL
  ═══════════════════════════════════════════════════════════════ */

  const openApplyModal = (job) => {
    if (!Auth.isAuthenticated()) {
      alert('You must be logged in as a seeker to apply.');
      window.location.href = '/login.html';
      return;
    }
    if (Auth.getRole() !== 'seeker') {
      alert('Only job seekers can submit applications.');
      return;
    }

    selectedJobId = job._id;
    if (applyJobIdInput) applyJobIdInput.value = job._id;
    if (applyJobName)   applyJobName.textContent = `Applying for: ${job.title} at ${job.company}`;
    if (coverLetterEl)  coverLetterEl.value = '';
    if (coverCount)     coverCount.textContent = '0 / 5,000 characters';
    applyError?.classList.remove('visible');

    applyModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    coverLetterEl?.focus();
  };

  const closeApplyModal = () => {
    applyModal.classList.remove('open');
    document.body.style.overflow = '';
  };

  applyModalClose?.addEventListener('click', closeApplyModal);
  applyModal?.addEventListener('click', (e) => { if (e.target === applyModal) closeApplyModal(); });

  // Character counter
  coverLetterEl?.addEventListener('input', () => {
    const len = coverLetterEl.value.length;
    if (coverCount) coverCount.textContent = `${len.toLocaleString()} / 5,000 characters`;
  });

  // Apply form submit
  applyForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!selectedJobId) return;

    const coverLetter = coverLetterEl?.value.trim() ?? '';

    if (applyError) {
      applyError.textContent = '';
      applyError.classList.remove('visible');
    }

    applySubmitBtn.textContent = 'Submitting…';
    applySubmitBtn.classList.add('btn--loading');
    applySubmitBtn.disabled = true;

    try {
      await API.post('/applications', { jobId: selectedJobId, coverLetter });

      closeApplyModal();
      Toast.success('Application submitted successfully! 🎉');

    } catch (err) {
      // alert() as required
      alert(`Application failed: ${err.message}`);
      if (applyError) {
        applyError.textContent = err.message;
        applyError.classList.add('visible');
      }
    } finally {
      applySubmitBtn.textContent = 'Submit Application';
      applySubmitBtn.classList.remove('btn--loading');
      applySubmitBtn.disabled = false;
    }
  });

  /* ═══════════════════════════════════════════════════════════════
     SEARCH & FILTER WIRING
  ═══════════════════════════════════════════════════════════════ */

  // Search form submit
  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    currentPage = 1;
    activeFilters.search   = kwInput?.value.trim() || undefined;
    activeFilters.location = locInput?.value.trim() || undefined;
    fetchJobs(buildQueryParams(), false);
  });

  // Sort change
  sortSelect?.addEventListener('change', () => {
    currentPage = 1;
    activeFilters.sort = sortSelect.value;
    fetchJobs(buildQueryParams(), false);
  });

  // Filter tag clicks
  filterTags.forEach((tag) => {
    tag.addEventListener('click', () => {
      const filter   = tag.dataset.filter;
      const isActive = tag.classList.toggle('active');
      tag.setAttribute('aria-pressed', String(isActive));

      // Map filter tag → API param
      if (['remote', 'full-time', 'part-time', 'contract', 'internship'].includes(filter)) {
        if (filter === 'remote') {
          activeFilters.locationType = isActive ? 'remote' : undefined;
        } else {
          activeFilters.jobType = isActive ? filter : undefined;
        }
      } else {
        activeFilters.category = isActive ? filter : undefined;
      }

      // Deactivate other tags of the same type
      filterTags.forEach((other) => {
        if (other !== tag) {
          other.classList.remove('active');
          other.setAttribute('aria-pressed', 'false');
        }
      });

      currentPage = 1;
      fetchJobs(buildQueryParams(), false);
    });
  });

  // Category cards (browse by category section)
  document.querySelectorAll('[data-category]').forEach((card) => {
    card.addEventListener('click', () => {
      const cat = card.dataset.category;
      currentPage = 1;
      activeFilters = { category: cat };
      // Scroll up to jobs grid
      document.getElementById('jobs-section')?.scrollIntoView({ behavior: 'smooth' });
      fetchJobs(buildQueryParams(), false);
    });
  });

  // Load more
  loadMoreBtn?.addEventListener('click', () => {
    currentPage++;
    fetchJobs({ ...buildQueryParams(), page: currentPage }, true);
  });

  // Keyboard: close modals on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeJobModal();
      closeApplyModal();
    }
  });

  /** Convert activeFilters state into an API query-params object */
  const buildQueryParams = () => {
    const params = { page: currentPage, limit: 9 };
    if (activeFilters.search)      params.search      = activeFilters.search;
    if (activeFilters.location)    params.location    = activeFilters.location;
    if (activeFilters.sort)        params.sort        = activeFilters.sort;
    if (activeFilters.category)    params.category    = activeFilters.category;
    if (activeFilters.jobType)     params.jobType     = activeFilters.jobType;
    if (activeFilters.locationType) params.locationType = activeFilters.locationType;
    // Strip undefined values
    return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
  };

  /* ═══════════════════════════════════════════════════════════════
     UTILITIES
  ═══════════════════════════════════════════════════════════════ */

  /** Escape HTML special characters to prevent XSS */
  const escHtml = (str = '') =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  /** Deterministic emoji avatar for a company name */
  const COMPANY_EMOJIS = ['🏢', '🚀', '💡', '🌍', '🔬', '🎯', '⚡', '🏗️', '🛸', '🎨'];
  const getCompanyEmoji = (name = '') => {
    const code = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return COMPANY_EMOJIS[code % COMPANY_EMOJIS.length];
  };

  /* ═══════════════════════════════════════════════════════════════
     INITIAL LOAD
  ═══════════════════════════════════════════════════════════════ */
  fetchJobs({ page: 1, limit: 9, sort: 'newest' });
});
