// State Management
const state = {
  activePanel: 'dashboard',
  previousPanel: 'dashboard',
  jobs: [],
  skills: [],
  selectedJobForPrep: null,
  prepQuestions: [],
  currentCardIndex: 0,
  tailoredResumeJSON: null,
  activeTailoredJobId: null
};

// API Base URL (local server)
const API_URL = '';

// Get API request headers containing user's client-side API Key
function getApiHeaders() {
  const key = localStorage.getItem('user_api_key') || '';
  return {
    'Content-Type': 'application/json',
    'x-api-key': key
  };
}

// Get the user's selected Claude model
function getSelectedModel() {
  return localStorage.getItem('user_model') || 'claude-haiku-4-5-20251001';
}

// DOM Elements
const panels = document.querySelectorAll('.panel');
const navItems = document.querySelectorAll('.nav-item');
const toastEl = document.getElementById('toast');
const toastMsg = document.getElementById('toast-message');
const loaderEl = document.getElementById('loading-overlay');
const loaderTitle = document.getElementById('loading-title');

// Initialize Lucide Icons
function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Show Toast Notification
function showToast(message, duration = 3000) {
  toastMsg.textContent = message;
  toastEl.style.display = 'flex';
  setTimeout(() => {
    toastEl.style.display = 'none';
  }, duration);
}

// Show Loader
function showLoader(title, subtitle = 'This may take a moment...') {
  loaderTitle.textContent = title;
  document.getElementById('loading-subtitle').textContent = subtitle;
  loaderEl.style.display = 'flex';
}

// Hide Loader
function hideLoader() {
  loaderEl.style.display = 'none';
}

// --- NAVIGATION & VIEW MANAGEMENT ---
function switchPanel(panelId) {
  if (state.activePanel !== panelId) {
    state.previousPanel = state.activePanel;
  }

  panels.forEach(p => p.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));

  const targetPanel = document.getElementById(`panel-${panelId}`);
  const targetNav = document.querySelector(`.nav-item[data-target="${panelId}"]`);

  if (targetPanel) targetPanel.classList.add('active');
  if (targetNav) targetNav.classList.add('active');

  state.activePanel = panelId;

  // Perform view-specific loads
  if (panelId === 'dashboard') {
    loadDashboardData();
  } else if (panelId === 'jobs-log') {
    renderJobsTable();
  } else if (panelId === 'skills-browser') {
    loadSkillsList();
  } else if (panelId === 'settings') {
    loadSettingsData();
  } else if (panelId === 'interview-prep') {
    populatePrepJobSelector();
  } else if (panelId === 'resume-tailor') {
    populateTailorJobSelector();
  }
}

// Register Nav Events
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const target = item.getAttribute('data-target');
    switchPanel(target);
  });
});

// --- API ACTIONS ---

// Fetch Jobs
async function fetchJobs() {
  try {
    const res = await fetch(`${API_URL}/api/jobs`);
    if (!res.ok) throw new Error('Failed to fetch jobs');
    state.jobs = await res.json();
    return state.jobs;
  } catch (err) {
    console.error(err);
    showToast('Failed to load applications');
    return [];
  }
}

// Update Job Status
async function updateJobStatus(id, newStatus) {
  try {
    const res = await fetch(`${API_URL}/api/jobs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) throw new Error('Failed to update job status');
    
    // Update local state
    const jobIndex = state.jobs.findIndex(j => j.id === id);
    if (jobIndex !== -1) {
      state.jobs[jobIndex].status = newStatus;
    }
    
    showToast(`Status updated to ${newStatus}`);
    loadDashboardData();
  } catch (err) {
    console.error(err);
    showToast('Failed to update status');
  }
}

// Delete Job
async function deleteJob(id) {
  if (!confirm('Are you sure you want to delete this job application log?')) return;
  try {
    const res = await fetch(`${API_URL}/api/jobs/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete job');
    state.jobs = state.jobs.filter(j => j.id !== id);
    showToast('Job application deleted');
    if (state.activePanel === 'dashboard') loadDashboardData();
    else renderJobsTable();
  } catch (err) {
    console.error(err);
    showToast('Failed to delete job');
  }
}
window.deleteJob = deleteJob;

// --- DASHBOARD CONTROLLER ---
async function loadDashboardData() {
  await fetchJobs();
  
  // Update Stats Cards
  const totalApplied = state.jobs.filter(j => j.status === 'Applied').length;
  const totalInterviewing = state.jobs.filter(j => j.status === 'Interviewing').length;
  const totalOffered = state.jobs.filter(j => j.status === 'Offered').length;
  
  document.getElementById('stat-applied').textContent = totalApplied;
  document.getElementById('stat-interviewing').textContent = totalInterviewing;
  document.getElementById('stat-offered').textContent = totalOffered;

  // Calculate Average Match Score
  const analyzedJobs = state.jobs.filter(j => j.matchScore !== null);
  if (analyzedJobs.length > 0) {
    const avgScore = Math.round(analyzedJobs.reduce((acc, j) => acc + j.matchScore, 0) / analyzedJobs.length);
    document.getElementById('stat-match-avg').textContent = `${avgScore}%`;
  } else {
    document.getElementById('stat-match-avg').textContent = '0%';
  }

  renderKanbanPipeline();
  renderUpcomingEvents();
}

function renderKanbanPipeline() {
  const columns = ['Wishlist', 'Applied', 'Interviewing', 'Offered', 'Rejected'];
  
  columns.forEach(col => {
    const listEl = document.getElementById(`col-${col.toLowerCase()}`);
    const countEl = document.getElementById(`count-${col.toLowerCase()}`);
    listEl.innerHTML = '';
    
    const colJobs = state.jobs.filter(j => j.status === col);
    countEl.textContent = colJobs.length;

    if (colJobs.length === 0) {
      listEl.innerHTML = `<p class="empty-state">No jobs</p>`;
      return;
    }

    colJobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.draggable = true;
      card.dataset.id = job.id;
      
      card.innerHTML = `
        <h4>${job.role}</h4>
        <p>${job.company}</p>
        <div class="kanban-card-meta">
          <span class="date">${job.dateApplied}</span>
          ${job.matchScore !== null ? `<span class="card-match-pill">${job.matchScore}% Fit</span>` : ''}
        </div>
      `;

      // Drag Events
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', job.id);
        card.style.opacity = '0.5';
      });

      card.addEventListener('dragend', () => {
        card.style.opacity = '1';
      });

      card.addEventListener('click', () => {
        // Direct to tailored resume workshop or logs panel
        if (job.jd) {
          document.getElementById('tailor-company').value = job.company;
          document.getElementById('tailor-role').value = job.role;
          document.getElementById('tailor-link').value = job.link || '';
          document.getElementById('tailor-jd').value = job.jd;
          state.activeTailoredJobId = job.id;
          
          if (job.analysis) {
            displayAnalysisResults(job.analysis);
          }
          if (job.tailoredResume) {
            state.tailoredResumeJSON = job.tailoredResume;
            displayTailoredResume(job.tailoredResume);
          } else {
            // Reset preview
            document.getElementById('resume-workspace-area').style.display = 'none';
            document.getElementById('resume-empty').style.display = 'flex';
          }
          
          switchPanel('resume-tailor');
        } else {
          switchPanel('jobs-log');
        }
      });

      listEl.appendChild(card);
    });
  });

  // Kanban Column Drag Over Config
  const kanbanColumns = document.querySelectorAll('.kanban-column');
  kanbanColumns.forEach(column => {
    const cardsContainer = column.querySelector('.kanban-cards');
    
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      cardsContainer.classList.add('drag-over');
    });

    column.addEventListener('dragleave', () => {
      cardsContainer.classList.remove('drag-over');
    });

    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      cardsContainer.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const newStatus = column.getAttribute('data-status');
      if (id && newStatus) {
        await updateJobStatus(id, newStatus);
      }
    });
  });
}

function renderUpcomingEvents() {
  const container = document.getElementById('upcoming-events-list');
  container.innerHTML = '';
  
  // Filter jobs that are in "Interviewing" status and show them
  const interviewingJobs = state.jobs.filter(j => j.status === 'Interviewing');
  if (interviewingJobs.length === 0) {
    container.innerHTML = `<p class="empty-state">No upcoming interviews scheduled yet.</p>`;
    return;
  }

  interviewingJobs.forEach(job => {
    const dateObj = new Date(job.dateApplied);
    // Add 10 days as placeholder event
    const interviewDate = new Date(dateObj.getTime() + (10 * 24 * 60 * 60 * 1000));
    const day = interviewDate.getDate();
    const month = interviewDate.toLocaleString('default', { month: 'short' });

    const item = document.createElement('div');
    item.className = 'alert-item';
    item.innerHTML = `
      <div class="alert-date">
        <span class="month">${month}</span>
        <span class="day">${day}</span>
      </div>
      <div class="alert-info">
        <h4>${job.company} — Mock Interview</h4>
        <p>${job.role} preparation</p>
      </div>
    `;
    
    item.addEventListener('click', () => {
      switchPanel('interview-prep');
      document.getElementById('prep-job-select').value = job.id;
      loadInterviewPrepForJob(job.id);
    });
    
    container.appendChild(item);
  });
}

// --- APPLICATIONS LOG CONTROLLER ---
function renderJobsTable() {
  const body = document.getElementById('jobs-table-body');
  body.innerHTML = '';
  
  const filterVal = document.querySelector('.filter-btn.active').getAttribute('data-filter');
  
  const filteredJobs = state.jobs.filter(j => {
    if (filterVal === 'All') return true;
    return j.status === filterVal;
  });

  if (filteredJobs.length === 0) {
    body.innerHTML = `<tr><td colspan="6" class="empty-state">No applications found in this category.</td></tr>`;
    return;
  }

  // Sort by date descending
  filteredJobs.sort((a, b) => new Date(b.dateApplied) - new Date(a.dateApplied));

  filteredJobs.forEach(job => {
    const tr = document.createElement('tr');
    
    // Match Score styling
    let scorePill = `<span class="score-pill low">Pending</span>`;
    if (job.matchScore !== null) {
      const score = job.matchScore;
      let ratingClass = 'low';
      if (score >= 75) ratingClass = 'high';
      else if (score >= 60) ratingClass = 'mid';
      scorePill = `<span class="score-pill ${ratingClass}">${score}% Match</span>`;
    }

    tr.innerHTML = `
      <td>
        <div class="role-info">
          <h4>${job.role}</h4>
          <p>${job.company}</p>
        </div>
      </td>
      <td>${job.dateApplied}</td>
      <td><span class="badge ${job.status.toLowerCase()}">${job.status}</span></td>
      <td>${scorePill}</td>
      <td>
        ${job.jd ? `<span class="badge applied" style="cursor:help;" title="${job.jd.substring(0, 100)}...">Attached</span>` : `<span class="badge rejected">None</span>`}
      </td>
      <td>
        <div class="action-icons">
          <button class="icon-btn" title="Edit/View details" onclick="editJobModal('${job.id}')"><i data-lucide="edit-3"></i></button>
          <button class="icon-btn text-accent" title="Tailor Resume" onclick="loadTailorForJob('${job.id}')"><i data-lucide="file-text"></i></button>
          <button class="icon-btn text-glow" title="Interview Prep" onclick="loadPrepForJob('${job.id}')"><i data-lucide="messages-square"></i></button>
          <button class="icon-btn btn-delete" title="Delete application" onclick="deleteJob('${job.id}')"><i data-lucide="trash-2"></i></button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
  
  initIcons();
}

// Handle Table Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderJobsTable();
  });
});

// Load Tailor tab for specific job
window.loadTailorForJob = function(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  state.activeTailoredJobId = job.id;
  document.getElementById('tailor-company').value = job.company;
  document.getElementById('tailor-role').value = job.role;
  document.getElementById('tailor-link').value = job.link || '';
  document.getElementById('tailor-jd').value = job.jd;
  
  if (job.analysis) displayAnalysisResults(job.analysis);
  else resetAnalysisUI();

  if (job.tailoredResume) {
    state.tailoredResumeJSON = job.tailoredResume;
    displayTailoredResume(job.tailoredResume);
  } else {
    resetResumeUI();
  }

  switchPanel('resume-tailor');
};

// Load Prep tab for specific job
window.loadPrepForJob = function(jobId) {
  switchPanel('interview-prep');
  document.getElementById('prep-job-select').value = jobId;
  loadInterviewPrepForJob(jobId);
};

// Populate Job Selector for Resume Tailor page
async function populateTailorJobSelector() {
  await fetchJobs();
  const select = document.getElementById('tailor-job-select');
  if (!select) return;
  
  select.innerHTML = '<option value="new">-- Create New / Start from Scratch --</option>';
  
  state.jobs.forEach(job => {
    const opt = document.createElement('option');
    opt.value = job.id;
    opt.textContent = `${job.role} at ${job.company}`;
    select.appendChild(opt);
  });
  
  select.value = state.activeTailoredJobId || 'new';
}

// Bind Job Selector Change Event
document.getElementById('tailor-job-select').addEventListener('change', (e) => {
  const jobId = e.target.value;
  if (jobId === 'new') {
    state.activeTailoredJobId = null;
    document.getElementById('tailor-company').value = '';
    document.getElementById('tailor-role').value = '';
    document.getElementById('tailor-link').value = '';
    document.getElementById('tailor-jd').value = '';
    resetAnalysisUI();
    resetResumeUI();
  } else {
    const job = state.jobs.find(j => j.id === jobId);
    if (!job) return;
    state.activeTailoredJobId = job.id;
    document.getElementById('tailor-company').value = job.company;
    document.getElementById('tailor-role').value = job.role;
    document.getElementById('tailor-link').value = job.link || '';
    document.getElementById('tailor-jd').value = job.jd;
    
    if (job.analysis) {
      displayAnalysisResults(job.analysis);
    } else {
      resetAnalysisUI();
    }
    
    if (job.tailoredResume) {
      state.tailoredResumeJSON = job.tailoredResume;
      displayTailoredResume(job.tailoredResume);
    } else {
      resetResumeUI();
    }
  }
});

// --- RESUME TAILOR CONTROLLER ---
const tailorForm = document.getElementById('tailor-form');
tailorForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const company = document.getElementById('tailor-company').value;
  const role = document.getElementById('tailor-role').value;
  const link = document.getElementById('tailor-link').value;
  const jd = document.getElementById('tailor-jd').value;

  showLoader('Analyzing Job Description...', 'Using ATS Optimizer & JD Analyzer skills');

  try {
    // 1. Check API works and user has base resume
    const baseResumeRes = await fetch(`${API_URL}/api/base-resume`);
    const baseResumeData = await baseResumeRes.json();
    if (!baseResumeData.content) {
      throw new Error("Base resume is missing. Please save a Base Resume in Settings first!");
    }

    // 2. Perform JD Analysis
    const analysisRes = await fetch(`${API_URL}/api/analyze-jd`, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({ jd, company, role, model: getSelectedModel() })
    });
    
    if (!analysisRes.ok) {
      const errData = await analysisRes.json();
      throw new Error(errData.error || 'Job analysis request failed');
    }
    const analysis = await analysisRes.json();
    displayAnalysisResults(analysis);

    // 3. Tailor Resume (Strictly 1-page structured JSON)
    showLoader('Tailoring Single-Page Resume...', 'Injecting Executive Resume Writer guidelines');
    
    const resumeRes = await fetch(`${API_URL}/api/tailor-resume`, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({ jd, company, role, model: getSelectedModel() })
    });

    if (!resumeRes.ok) {
      const errData = await resumeRes.json();
      throw new Error(errData.error || 'Resume tailoring request failed');
    }
    const tailoredResume = await resumeRes.json();
    state.tailoredResumeJSON = tailoredResume;
    displayTailoredResume(tailoredResume);

    // 4. Save to application database if activeTailoredJobId exists
    // If we initiated from a specific log item, save there. Otherwise check if we should save as new.
    let jobId = state.activeTailoredJobId;
    if (!jobId) {
      // Create a new job record first
      const addJobRes = await fetch(`${API_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, role, link, jd, status: 'Applied' })
      });
      const newJob = await addJobRes.json();
      jobId = newJob.id;
      state.activeTailoredJobId = jobId;
    }

    // Update job record with analysis and tailored resume
    await fetch(`${API_URL}/api/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jd,
        link,
        matchScore: analysis.matchScore,
        analysis: analysis,
        tailoredResume: tailoredResume
      })
    });

    showToast('Analysis & tailored resume created successfully');
    await populateTailorJobSelector();
  } catch (err) {
    console.error(err);
    alert(err.message);
  } finally {
    hideLoader();
  }
});

function displayAnalysisResults(analysis) {
  document.getElementById('analysis-empty').style.display = 'none';
  const area = document.getElementById('analysis-results-area');
  area.style.display = 'block';

  // Match score ring animation
  const percentageCircle = document.getElementById('radial-score-bar');
  const textVal = document.getElementById('radial-score-text');
  const score = analysis.matchScore || 0;
  
  percentageCircle.setAttribute('stroke-dasharray', `${score}, 100`);
  textVal.textContent = `${score}%`;

  document.getElementById('analysis-recommendation').textContent = analysis.recommendation || 'Analysis Complete';
  document.getElementById('analysis-priority').textContent = analysis.priority || 'MEDIUM';
  document.getElementById('analysis-strategy').textContent = analysis.tailoringStrategy || '';

  // Draw strengths
  const strengthsUl = document.getElementById('analysis-strengths-list');
  strengthsUl.innerHTML = '';
  (analysis.strengths || []).forEach(s => {
    const li = document.createElement('li');
    li.textContent = s;
    strengthsUl.appendChild(li);
  });

  // Draw gaps
  const gapsUl = document.getElementById('analysis-gaps-list');
  gapsUl.innerHTML = '';
  (analysis.gaps || []).forEach(g => {
    const li = document.createElement('li');
    li.textContent = g;
    gapsUl.appendChild(li);
  });

  // Draw checklist
  const checkContainer = document.getElementById('analysis-req-skills');
  checkContainer.innerHTML = '';
  
  const allSkillsList = [
    ...(analysis.requiredSkills || []).map(s => ({...s, required: true})),
    ...(analysis.preferredSkills || []).map(s => ({...s, required: false}))
  ];

  if (allSkillsList.length === 0) {
    checkContainer.innerHTML = '<p class="empty-state">No required skills parsed.</p>';
  } else {
    allSkillsList.forEach(item => {
      const checkItem = document.createElement('div');
      checkItem.className = `checklist-item ${item.matched ? 'matched' : 'missed'}`;
      checkItem.innerHTML = `
        <i data-lucide="${item.matched ? 'check-circle-2' : 'alert-circle'}"></i>
        <div class="checklist-text">
          <strong>${item.skill}</strong> ${item.required ? `<span class="badge wishlist" style="display:inline-block; font-size: 8px; padding:1px 4px; margin-left: 6px;">Required</span>` : ''}
          <span>${item.details || ''}</span>
        </div>
      `;
      checkContainer.appendChild(checkItem);
    });
  }
  
  initIcons();
}

function displayTailoredResume(data) {
  document.getElementById('resume-empty').style.display = 'none';
  const area = document.getElementById('resume-workspace-area');
  area.style.display = 'block';

  const preview = document.getElementById('resume-preview-container');
  preview.innerHTML = renderTailoredResumeTemplate(data);

  // Sync Markdown Editor
  document.getElementById('markdown-empty').style.display = 'none';
  const mdArea = document.getElementById('markdown-workspace-area');
  if (mdArea) {
    mdArea.style.display = 'flex';
    document.getElementById('markdown-editor-textarea').value = generateResumeMarkdown(data);
  }
}

function resetAnalysisUI() {
  document.getElementById('analysis-empty').style.display = 'flex';
  document.getElementById('analysis-results-area').style.display = 'none';
}

function resetResumeUI() {
  document.getElementById('resume-empty').style.display = 'flex';
  document.getElementById('resume-workspace-area').style.display = 'none';

  // Reset Markdown UI
  document.getElementById('markdown-empty').style.display = 'flex';
  document.getElementById('markdown-workspace-area').style.display = 'none';
}

// Render JSON to HTML resume structure
function renderTailoredResumeTemplate(data) {
  return `
    <div class="resume-header">
      <h1 id="r-name">${data.name || 'SHAILYA GOHIL'}</h1>
      <div class="resume-contact" id="r-contact">
        <span id="r-loc">${data.contact.location}</span> | 
        <span id="r-phone">${data.contact.phone}</span> | 
        <span id="r-email">${data.contact.email}</span> | 
        <span id="r-linkedin">${data.contact.linkedin}</span>
      </div>
    </div>
    
    <div class="resume-section">
      <div class="resume-section-title">Summary</div>
      <p class="resume-summary" id="r-summary">${data.summary}</p>
    </div>
    
    <div class="resume-section">
      <div class="resume-section-title">Skills & Competencies</div>
      <div class="resume-skills-container">
        <div class="resume-skill-row">
          <strong>Core Capabilities:</strong> <span id="r-skills-core">${data.skills.core.join(' • ')}</span>
        </div>
        <div class="resume-skill-row">
          <strong>AI & Technical:</strong> <span id="r-skills-tech">${data.skills.technical.join(' • ')}</span>
        </div>
        <div class="resume-skill-row">
          <strong>Tools & Platforms:</strong> <span id="r-skills-tools">${data.skills.tools.join(', ')}</span>
        </div>
      </div>
    </div>
    
    <div class="resume-section">
      <div class="resume-section-title">Professional Experience</div>
      ${data.experience.map((exp, idx) => `
        <div class="resume-item">
          <div class="resume-item-header">
            <span class="company">${exp.company} <span class="role">- ${exp.role}</span></span>
            <span class="date-loc">${exp.dates} | ${exp.location}</span>
          </div>
          <ul class="resume-bullets" id="r-exp-bullets-${idx}">
            ${exp.bullets.map(b => `<li>${b}</li>`).join('')}
          </ul>
        </div>
      `).join('')}
    </div>
    
    <div class="resume-section">
      <div class="resume-section-title">Key Projects</div>
      ${data.projects.map((proj, idx) => `
        <div class="resume-project-item">
          <strong>${proj.title}</strong> — <span id="r-proj-details-${idx}">${proj.details}</span>
        </div>
      `).join('')}
    </div>
    
    <div class="resume-section" style="margin-bottom: 0;">
      <div class="resume-section-title">Education</div>
      ${data.education.map((edu, idx) => `
        <div class="resume-edu-item">
          <span><strong>${edu.institution}</strong> — <em id="r-edu-degree-${idx}">${edu.degree}</em></span>
          <span class="date">${edu.dates} | ${edu.location}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// Save resume from DOM edits to the active application log
document.getElementById('btn-save-resume-log').addEventListener('click', async () => {
  if (!state.activeTailoredJobId) return;
  
  // Extract edited values from DOM
  const data = {
    name: document.getElementById('r-name').textContent,
    contact: {
      location: document.getElementById('r-loc').textContent,
      phone: document.getElementById('r-phone').textContent,
      email: document.getElementById('r-email').textContent,
      linkedin: document.getElementById('r-linkedin').textContent
    },
    summary: document.getElementById('r-summary').textContent,
    skills: {
      core: document.getElementById('r-skills-core').textContent.split(' • '),
      technical: document.getElementById('r-skills-tech').textContent.split(' • '),
      tools: document.getElementById('r-skills-tools').textContent.split(', ')
    },
    experience: state.tailoredResumeJSON.experience.map((exp, idx) => {
      const ul = document.getElementById(`r-exp-bullets-${idx}`);
      const bullets = Array.from(ul.querySelectorAll('li')).map(li => li.textContent);
      return { ...exp, bullets };
    }),
    projects: state.tailoredResumeJSON.projects.map((proj, idx) => {
      const details = document.getElementById(`r-proj-details-${idx}`).textContent;
      return { ...proj, details };
    }),
    education: state.tailoredResumeJSON.education
  };

  try {
    await fetch(`${API_URL}/api/jobs/${state.activeTailoredJobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tailoredResume: data })
    });
    state.tailoredResumeJSON = data;
    showToast('Edited resume saved to log successfully');
  } catch (err) {
    showToast('Failed to save edited resume');
  }
});

// Helper: Generate structured Markdown representation from resume JSON
function generateResumeMarkdown(data) {
  if (!data) return '';
  return `# ${data.name.toUpperCase()}
${data.contact.location} | ${data.contact.phone} | ${data.contact.email} | ${data.contact.linkedin}

## PROFESSIONAL SUMMARY
${data.summary}

## CORE SKILLS
- **Key Capabilities:** ${data.skills.core.join(', ')}
- **AI & Technical:** ${data.skills.technical.join(', ')}
- **Tools & Platforms:** ${data.skills.tools.join(', ')}

## WORK EXPERIENCE
${data.experience.map(exp => `### ${exp.company} | ${exp.location}
*${exp.role}* (${exp.dates})
${exp.bullets.map(b => `- ${b}`).join('\n')}
`).join('\n')}

## KEY PROJECTS
${data.projects.map(proj => `- **${proj.title}:** ${proj.details}`).join('\n')}

## EDUCATION
${data.education.map(edu => `- **${edu.institution}**: ${edu.degree} (${edu.dates}) - ${edu.location}`).join('\n')}
`;
}

// Helper: Parse edited Markdown back into structured resume JSON
function parseMarkdownToResumeJSON(md) {
  const lines = md.split('\n');
  const data = {
    name: 'SHAILYA GOHIL',
    contact: { location: '', phone: '', email: '', linkedin: '' },
    summary: '',
    skills: { core: [], technical: [], tools: [] },
    experience: [],
    projects: [],
    education: []
  };

  let currentSection = '';
  let currentExperience = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // Name (Header 1)
    if (line.startsWith('# ')) {
      data.name = line.substring(2).trim();
      continue;
    }

    // Contact line (contains location | phone | email | linkedin)
    if (line.includes('|') && !line.startsWith('|') && currentSection === '') {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 1) data.contact.location = parts[0];
      if (parts.length >= 2) data.contact.phone = parts[1];
      if (parts.length >= 3) data.contact.email = parts[2];
      if (parts.length >= 4) data.contact.linkedin = parts[3];
      continue;
    }

    // Sections (Header 2)
    if (line.startsWith('## ')) {
      const title = line.substring(3).trim().toUpperCase();
      if (title.includes('SUMMARY')) {
        currentSection = 'summary';
      } else if (title.includes('SKILLS') || title.includes('COMPETENCIES')) {
        currentSection = 'skills';
      } else if (title.includes('EXPERIENCE')) {
        currentSection = 'experience';
      } else if (title.includes('PROJECTS')) {
        currentSection = 'projects';
      } else if (title.includes('EDUCATION')) {
        currentSection = 'education';
      } else {
        currentSection = '';
      }
      continue;
    }

    // Section Content parsing
    if (currentSection === 'summary') {
      data.summary = (data.summary ? data.summary + '\n' : '') + line;
    } else if (currentSection === 'skills') {
      if (line.toLowerCase().includes('capabilities:') || line.toLowerCase().includes('core:')) {
        const skillsText = line.split(':')[1] || '';
        data.skills.core = skillsText.split(',').map(s => s.trim()).filter(Boolean);
        if (data.skills.core.length === 1 && skillsText.includes('•')) {
          data.skills.core = skillsText.split('•').map(s => s.trim()).filter(Boolean);
        }
      } else if (line.toLowerCase().includes('technical:') || line.toLowerCase().includes('ai:')) {
        const skillsText = line.split(':')[1] || '';
        data.skills.technical = skillsText.split(',').map(s => s.trim()).filter(Boolean);
        if (data.skills.technical.length === 1 && skillsText.includes('•')) {
          data.skills.technical = skillsText.split('•').map(s => s.trim()).filter(Boolean);
        }
      } else if (line.toLowerCase().includes('tools:')) {
        const skillsText = line.split(':')[1] || '';
        data.skills.tools = skillsText.split(',').map(s => s.trim()).filter(Boolean);
        if (data.skills.tools.length === 1 && skillsText.includes('•')) {
          data.skills.tools = skillsText.split('•').map(s => s.trim()).filter(Boolean);
        }
      }
    } else if (currentSection === 'experience') {
      if (line.startsWith('### ')) {
        if (currentExperience) {
          data.experience.push(currentExperience);
        }
        const parts = line.substring(4).split('|').map(p => p.trim());
        currentExperience = {
          company: parts[0] || '',
          location: parts[1] || '',
          role: '',
          dates: '',
          bullets: []
        };
      } else if (line.startsWith('*') && currentExperience) {
        const match = line.match(/\*(.*?)\*\s*\((.*?)\)/);
        if (match) {
          currentExperience.role = match[1].trim();
          currentExperience.dates = match[2].trim();
        } else {
          currentExperience.role = line.replace(/\*/g, '').trim();
        }
      } else if (line.startsWith('- ') && currentExperience) {
        currentExperience.bullets.push(line.substring(2).trim());
      }
    } else if (currentSection === 'projects') {
      if (line.startsWith('- ')) {
        const text = line.substring(2).trim();
        const parts = text.split(':');
        const title = parts[0] || '';
        const details = parts.slice(1).join(':').trim();
        data.projects.push({
          title: title.replace(/\*\*/g, '').trim(),
          details: details
        });
      }
    } else if (currentSection === 'education') {
      if (line.startsWith('- ')) {
        const text = line.substring(2).trim();
        const parts = text.split(':');
        const inst = parts[0] || '';
        const rest = parts.slice(1).join(':').trim();
        
        let degree = '';
        let dates = '';
        let loc = '';
        
        const match = rest.match(/(.*?)\((.*?)\)\s*-\s*(.*)/);
        if (match) {
          degree = match[1].trim();
          dates = match[2].trim();
          loc = match[3].trim();
        } else {
          degree = rest;
        }
        
        data.education.push({
          institution: inst.replace(/\*\*/g, '').trim(),
          degree: degree,
          dates: dates,
          location: loc
        });
      }
    }
  }

  if (currentExperience) {
    data.experience.push(currentExperience);
  }

  return data;
}

// Copy resume markdown to clipboard
document.getElementById('btn-copy-md').addEventListener('click', () => {
  if (!state.tailoredResumeJSON) return;
  const md = generateResumeMarkdown(state.tailoredResumeJSON);
  navigator.clipboard.writeText(md).then(() => {
    showToast('Markdown copied to clipboard!');
  });
});

// Trigger A4 Resume Printing
document.getElementById('btn-print-resume').addEventListener('click', () => {
  window.print();
});

// Compile Markdown to Preview
document.getElementById('btn-compile-markdown').addEventListener('click', () => {
  const mdText = document.getElementById('markdown-editor-textarea').value;
  if (!mdText.trim()) {
    showToast('Please enter some markdown content');
    return;
  }
  
  try {
    const parsedData = parseMarkdownToResumeJSON(mdText);
    state.tailoredResumeJSON = parsedData;
    
    // Render and display compiled HTML
    displayTailoredResume(parsedData);
    
    // Switch to Tailored Resume tab
    document.getElementById('tab-resume-preview').click();
    showToast('Markdown compiled & updated in preview!');
  } catch (err) {
    console.error(err);
    showToast('Failed to compile markdown');
  }
});

// Convert Markdown to PDF
document.getElementById('btn-markdown-to-pdf').addEventListener('click', () => {
  const mdText = document.getElementById('markdown-editor-textarea').value;
  if (!mdText.trim()) {
    showToast('Please enter some markdown content');
    return;
  }

  if (typeof html2pdf === 'undefined') {
    showToast('PDF Library loading... Please try again in a second.');
    return;
  }

  showLoader('Generating PDF...', 'Converting markdown to print-perfect PDF...');
  
  try {
    const parsedData = parseMarkdownToResumeJSON(mdText);
    
    // Create temporary element configured exactly like A4 print page
    const element = document.createElement('div');
    element.className = 'resume-a4-page';
    element.style.width = '210mm';
    element.style.height = '297mm';
    element.style.padding = '12mm 15mm';
    element.style.boxShadow = 'none';
    element.style.margin = '0';
    element.style.boxSizing = 'border-box';
    element.innerHTML = renderTailoredResumeTemplate(parsedData);
    
    const opt = {
      margin:       0,
      filename:     `${parsedData.name.replace(/\s+/g, '_')}_Resume.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    html2pdf().set(opt).from(element).save().then(() => {
      hideLoader();
      showToast('PDF downloaded successfully!');
    }).catch(err => {
      console.error(err);
      hideLoader();
      showToast('Failed to download PDF');
    });
  } catch (err) {
    console.error(err);
    hideLoader();
    showToast('Failed to generate PDF');
  }
});

// Switch between workspace tabs
document.querySelectorAll('.w-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.w-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    document.getElementById(tab.getAttribute('data-tab')).classList.add('active');
  });
});

// --- INTERVIEW PREP CONTROLLER ---
function populatePrepJobSelector() {
  const select = document.getElementById('prep-job-select');
  select.innerHTML = '<option value="">-- Choose an application --</option>';
  
  // Only list jobs that have a Job Description attached
  const eligibleJobs = state.jobs.filter(j => j.jd);
  if (eligibleJobs.length === 0) return;
  
  eligibleJobs.forEach(job => {
    const opt = document.createElement('option');
    opt.value = job.id;
    opt.textContent = `${job.role} at ${job.company}`;
    select.appendChild(opt);
  });
  
  if (state.selectedJobForPrep) {
    select.value = state.selectedJobForPrep.id;
  }
}

document.getElementById('prep-job-select').addEventListener('change', (e) => {
  const jobId = e.target.value;
  if (!jobId) {
    resetPrepUI();
    return;
  }
  loadInterviewPrepForJob(jobId);
});

function loadInterviewPrepForJob(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  
  state.selectedJobForPrep = job;
  
  if (job.interviewPrep && job.interviewPrep.length > 0) {
    state.prepQuestions = job.interviewPrep;
    displayPrepQuestions();
  } else {
    resetPrepUI();
  }
}

// Generate interview prep via API
document.getElementById('btn-generate-prep').addEventListener('click', async () => {
  const jobId = document.getElementById('prep-job-select').value;
  if (!jobId) {
    showToast('Please select a job application');
    return;
  }

  const job = state.jobs.find(j => j.id === jobId);
  showLoader('Generating STAR Interview Prep...', 'Creating 10 customized interview questions & STAR answers');

  try {
    const res = await fetch(`${API_URL}/api/generate-prep`, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({ jd: job.jd, company: job.company, role: job.role, model: getSelectedModel() })
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to generate prep');
    }
    
    const questions = await res.json();
    state.prepQuestions = questions;
    
    // Save to server
    await fetch(`${API_URL}/api/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewPrep: questions })
    });
    
    // Update local state
    job.interviewPrep = questions;
    
    displayPrepQuestions();
    showToast('Generated 10 STAR interview questions!');
  } catch (err) {
    console.error(err);
    alert(err.message);
  } finally {
    hideLoader();
  }
});

function displayPrepQuestions() {
  document.getElementById('prep-empty').style.display = 'none';
  document.getElementById('prep-workspace').style.display = 'grid';
  
  state.currentCardIndex = 0;
  
  renderQuestionsSidebar();
  renderFlashcard(0);
}

function resetPrepUI() {
  document.getElementById('prep-empty').style.display = 'flex';
  document.getElementById('prep-workspace').style.display = 'none';
}

function renderQuestionsSidebar() {
  const container = document.getElementById('q-list-container');
  container.innerHTML = '';
  
  state.prepQuestions.forEach((q, idx) => {
    const item = document.createElement('div');
    item.className = `q-item ${idx === state.currentCardIndex ? 'active' : ''} ${q.status || ''}`;
    item.textContent = `${q.id}. ${q.question.substring(0, 50)}...`;
    
    item.addEventListener('click', () => {
      state.currentCardIndex = idx;
      renderFlashcard(idx);
      
      // Update active list style
      document.querySelectorAll('.q-item').forEach(qi => qi.classList.remove('active'));
      item.classList.add('active');
    });
    
    container.appendChild(item);
  });
}

function renderFlashcard(index) {
  const q = state.prepQuestions[index];
  if (!q) return;

  const card = document.getElementById('flashcard');
  card.classList.remove('flipped'); // Reset flip
  
  // Populate front
  document.getElementById('card-type').textContent = q.type || 'BEHAVIORAL';
  document.getElementById('card-question').textContent = q.question;
  
  // Populate back
  document.getElementById('card-situation').textContent = q.answer.situation || '';
  document.getElementById('card-task').textContent = q.answer.task || '';
  document.getElementById('card-action').textContent = q.answer.action || '';
  document.getElementById('card-result').textContent = q.answer.result || '';
  document.getElementById('card-tip').textContent = q.tips || '';
  
  // Update counter
  document.getElementById('card-counter').textContent = `${index + 1} / ${state.prepQuestions.length}`;
  
  // Highlight sidebar item
  document.querySelectorAll('.q-item').forEach((item, idx) => {
    if (idx === index) item.classList.add('active');
    else item.classList.remove('active');
  });

  initIcons();
}

// Flashcard navigation
document.getElementById('btn-card-next').addEventListener('click', () => {
  if (state.currentCardIndex < state.prepQuestions.length - 1) {
    state.currentCardIndex++;
    renderFlashcard(state.currentCardIndex);
  }
});

document.getElementById('btn-card-prev').addEventListener('click', () => {
  if (state.currentCardIndex > 0) {
    state.currentCardIndex--;
    renderFlashcard(state.currentCardIndex);
  }
});

// Flashcard flip trigger
document.getElementById('flashcard').addEventListener('click', (e) => {
  // Avoid flipping when clicking button inside card
  if (e.target.closest('button')) return;
  document.getElementById('flashcard').classList.toggle('flipped');
});

// Marking questions (mastered/review)
async function markQuestionStatus(status) {
  const index = state.currentCardIndex;
  const q = state.prepQuestions[index];
  if (!q) return;

  q.status = status; // 'mastered' or 'retry'
  renderQuestionsSidebar();
  
  // Save status to DB
  if (state.selectedJobForPrep) {
    try {
      await fetch(`${API_URL}/api/jobs/${state.selectedJobForPrep.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewPrep: state.prepQuestions })
      });
      showToast(`Marked card as: ${status === 'mastered' ? 'Mastered ✓' : 'Needs Review ✗'}`);
    } catch (err) {
      console.error(err);
    }
  }
}

document.getElementById('btn-mark-mastered').addEventListener('click', () => markQuestionStatus('mastered'));
document.getElementById('btn-mark-retry').addEventListener('click', () => markQuestionStatus('retry'));


// --- SKILLS BROWSER CONTROLLER ---
async function loadSkillsList() {
  const grid = document.getElementById('skills-grid-container');
  grid.innerHTML = '';
  
  try {
    const res = await fetch(`${API_URL}/api/skills`);
    const skills = await res.json();
    state.skills = skills;
    
    if (skills.length === 0) {
      grid.innerHTML = '<p class="empty-state">No skills loaded.</p>';
      return;
    }

    skills.forEach(skill => {
      const card = document.createElement('div');
      card.className = 'skill-card';
      card.innerHTML = `
        <h4>${skill.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</h4>
        <p>${skill.description}</p>
      `;
      
      card.addEventListener('click', () => {
        document.querySelectorAll('.skill-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        loadSkillDetail(skill.name);
      });
      
      grid.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    grid.innerHTML = '<p class="empty-state">Failed to load skills list.</p>';
  }
}

async function loadSkillDetail(skillName) {
  try {
    const res = await fetch(`${API_URL}/api/skills/${skillName}`);
    const detail = await res.json();
    
    document.getElementById('skill-viewer-title').textContent = skillName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    document.getElementById('skill-viewer-badge').textContent = 'active skill';
    
    const body = document.getElementById('skill-viewer-body');
    body.innerHTML = parseMarkdownToHTML(detail.content);
  } catch (err) {
    console.error(err);
    document.getElementById('skill-viewer-body').innerHTML = '<p class="empty-state">Failed to render skill details.</p>';
  }
}

// Simple Client-side Markdown to HTML Parser
function parseMarkdownToHTML(md) {
  if (!md) return '';
  let html = md;
  // Strip metadata block
  html = html.replace(/---[\s\S]*?---/, '');
  
  // Escape HTML tags slightly (except code)
  html = html.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  
  // Headers
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  
  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Bullet lists (ensure closing and opening lists correctly)
  html = html.replace(/^\s*[-*+]\s+(.*$)/gim, '<li>$1</li>');
  // Simple wrapping of sequences of li's in ul's
  html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, ''); // merge double tags
  
  // Tables
  const lines = html.split('\n');
  let inTable = false;
  let tableHTML = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableHTML = '<table>';
      }
      // Check if divider line
      if (line.includes('---')) {
        continue;
      }
      
      const cols = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
      const isHeader = i === 0 || (i > 0 && lines[i-1].trim() === '');
      
      tableHTML += '<tr>';
      cols.forEach(col => {
        tableHTML += isHeader ? `<th>${col}</th>` : `<td>${col}</td>`;
      });
      tableHTML += '</tr>';
      
      lines[i] = ''; // clear line
    } else {
      if (inTable) {
        inTable = false;
        tableHTML += '</table>';
        lines[i-1] += '\n' + tableHTML; // inject table back
      }
    }
  }
  
  if (inTable) {
    tableHTML += '</table>';
    lines[lines.length - 1] += '\n' + tableHTML;
  }
  
  html = lines.join('\n');
  
  // Code block
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  
  // Paragraphs
  html = html.split('\n\n').map(p => {
    if (p.trim().startsWith('<h') || p.trim().startsWith('<ul') || p.trim().startsWith('<table') || p.trim().startsWith('<pre')) {
      return p;
    }
    return p.trim() ? `<p>${p.trim()}</p>` : '';
  }).join('\n');
  
  return html;
}

// --- SETTINGS CONTROLLER ---
async function loadSettingsData() {
  // Load values from localStorage
  const savedKey = localStorage.getItem('user_api_key') || '';
  const savedModel = localStorage.getItem('user_model') || 'claude-haiku-4-5-20251001';
  
  document.getElementById('settings-api-key').value = savedKey;
  document.getElementById('settings-model-select').value = savedModel;

  // Check API Status
  try {
    const apiRes = await fetch(`${API_URL}/api/test-claude`, {
      headers: getApiHeaders()
    });
    const status = await apiRes.json();
    const indicator = document.querySelector('#api-status .status-indicator');
    const textSpan = document.getElementById('api-status-text');
    
    if (status.verified) {
      indicator.className = 'status-indicator active';
      if (savedKey) {
        textSpan.textContent = 'API Connected & Ready (User API key verified)';
      } else {
        textSpan.textContent = 'API Connected & Ready (Server-side default API key verified)';
      }
    } else if (status.status === 'error') {
      indicator.className = 'status-indicator';
      textSpan.textContent = `API Verification Failed: ${status.error}`;
    } else {
      indicator.className = 'status-indicator';
      textSpan.textContent = 'API key missing in both client and server configuration';
    }
  } catch (err) {
    console.error(err);
    const indicator = document.querySelector('#api-status .status-indicator');
    const textSpan = document.getElementById('api-status-text');
    indicator.className = 'status-indicator';
    textSpan.textContent = 'Failed to connect to local server';
  }

  // Fetch base resume
  try {
    const resumeRes = await fetch(`${API_URL}/api/base-resume`);
    const resume = await resumeRes.json();
    document.getElementById('settings-resume-editor').value = resume.content || '';
  } catch (err) {
    console.error(err);
  }
}

// Save Key & Model Configuration
document.getElementById('btn-save-key').addEventListener('click', async () => {
  const keyInput = document.getElementById('settings-api-key').value.trim();
  const modelSelect = document.getElementById('settings-model-select').value;
  
  localStorage.setItem('user_api_key', keyInput);
  localStorage.setItem('user_model', modelSelect);
  
  showToast('API Configuration saved successfully!');
  loadSettingsData();
});

// Test Key Button
document.getElementById('btn-test-key').addEventListener('click', async () => {
  const keyInput = document.getElementById('settings-api-key').value.trim();
  
  showLoader('Verifying API Key...', 'Sending test ping to Anthropic API...');
  try {
    const res = await fetch(`${API_URL}/api/test-claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ apiKey: keyInput })
    });
    
    if (!res.ok) throw new Error('API test request failed');
    const result = await res.json();
    
    const indicator = document.querySelector('#api-status .status-indicator');
    const textSpan = document.getElementById('api-status-text');
    
    if (result.verified) {
      showToast('API Key verified successfully!');
      indicator.className = 'status-indicator active';
      textSpan.textContent = 'API Connected & Ready (verified)';
    } else {
      showToast('API Key verification failed!');
      indicator.className = 'status-indicator';
      textSpan.textContent = `API Verification Failed: ${result.error || 'Invalid API Key'}`;
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to verify API Key');
  } finally {
    hideLoader();
  }
});

// Back Button on Resume Tailor Page
document.getElementById('btn-tailor-back').addEventListener('click', () => {
  const prev = state.previousPanel || 'dashboard';
  switchPanel(prev);
});

// Save Base Resume
document.getElementById('btn-save-base-resume').addEventListener('click', async () => {
  const content = document.getElementById('settings-resume-editor').value;
  try {
    const res = await fetch(`${API_URL}/api/base-resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error('Failed to save base resume');
    showToast('Base Resume updated successfully!');
  } catch (err) {
    console.error(err);
    showToast('Failed to save base resume');
  }
});


// --- MODAL & QUICK ADD ---
const modal = document.getElementById('modal-add-job');
const addJobForm = document.getElementById('modal-add-job-form');

document.getElementById('btn-quick-add').addEventListener('click', openAddJobModal);
document.getElementById('btn-add-job-panel').addEventListener('click', openAddJobModal);
document.getElementById('modal-close-btn').addEventListener('click', closeAddJobModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closeAddJobModal);

function openAddJobModal() {
  document.getElementById('modal-date').value = new Date().toISOString().split('T')[0];
  modal.classList.add('active');
}

function closeAddJobModal() {
  modal.classList.remove('active');
  addJobForm.reset();
  state.activeTailoredJobId = null;
}

addJobForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const company = document.getElementById('modal-company').value;
  const role = document.getElementById('modal-role').value;
  const link = document.getElementById('modal-link').value;
  const status = document.getElementById('modal-status').value;
  const dateApplied = document.getElementById('modal-date').value;
  const jd = document.getElementById('modal-jd').value;

  try {
    const res = await fetch(`${API_URL}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, role, link, status, dateApplied, jd })
    });
    
    if (!res.ok) throw new Error('Failed to log job');
    
    closeAddJobModal();
    showToast('Job application logged successfully!');
    
    // Refresh active panel
    if (state.activePanel === 'dashboard') loadDashboardData();
    else renderJobsTable();
  } catch (err) {
    console.error(err);
    showToast('Failed to log application');
  }
});

// Global edit mode
window.editJobModal = async function(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  
  // Fill form
  document.getElementById('modal-company').value = job.company;
  document.getElementById('modal-role').value = job.role;
  document.getElementById('modal-link').value = job.link || '';
  document.getElementById('modal-status').value = job.status;
  document.getElementById('modal-date').value = job.dateApplied;
  document.getElementById('modal-jd').value = job.jd || '';
  
  // Change submit handler for editing
  const oldSubmit = addJobForm.onsubmit;
  addJobForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/jobs/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: document.getElementById('modal-company').value,
          role: document.getElementById('modal-role').value,
          link: document.getElementById('modal-link').value,
          status: document.getElementById('modal-status').value,
          dateApplied: document.getElementById('modal-date').value,
          jd: document.getElementById('modal-jd').value
        })
      });
      if (!res.ok) throw new Error('Failed to update job');
      closeAddJobModal();
      showToast('Application updated successfully');
      
      // Reset handler
      addJobForm.onsubmit = null;
      
      if (state.activePanel === 'dashboard') loadDashboardData();
      else renderJobsTable();
    } catch (err) {
      console.error(err);
      showToast('Failed to update job');
    }
  };
  
  modal.classList.add('active');
};


// Boot Application
window.addEventListener('DOMContentLoaded', () => {
  switchPanel('dashboard');
  initIcons();
  
  // Theme Toggle Event Listener
  document.querySelector('.theme-toggle').addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    const icon = document.querySelector('.theme-toggle i');
    if (document.body.classList.contains('light-mode')) {
      icon.setAttribute('data-lucide', 'sun');
    } else {
      icon.setAttribute('data-lucide', 'moon');
    }
    initIcons();
  });
});
