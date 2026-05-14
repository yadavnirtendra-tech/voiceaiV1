/**
 * OpenCalendar - Dashboard JavaScript
 */

// ---- State ----
let currentUser = null;
let pollInterval = null;
let isBossMode = false;
let fullCalendarInstance = null;

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkUrlParams();
  checkAuthStatus();
  startPolling();
  startClock();
});

// ---- XSS Escaping ----
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ---- Theme ----
const THEMES = ['dark', 'light', 'newspaper'];
const THEME_ICONS = { dark: '🌙 Dark', light: '🌿 Green', newspaper: '📰 Gazette' };

function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeButton(savedTheme);
  applyThemeEffects(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const idx = THEMES.indexOf(current);
  const next = THEMES[(idx + 1) % THEMES.length];
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeButton(next);
  applyThemeEffects(next);
}

function updateThemeButton(theme) {
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = THEME_ICONS[theme] || '🌓';
}

function applyThemeEffects(theme) {
  const heroTitle = document.getElementById('heroTitle');
  const heroSub = document.getElementById('heroSubtitle');
  if (theme === 'newspaper') {
    if (heroTitle) heroTitle.textContent = 'THE OPENCALENDAR GAZETTE';
    if (heroSub) heroSub.textContent = 'Vol. I — No. 01 | ' + new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + ' | Real-Time Intelligence';
  } else {
    if (heroTitle) heroTitle.textContent = 'Unified Calendar Intelligence';
    if (heroSub) heroSub.textContent = 'Real-time cross-platform calendar synchronization. Your single source of truth for availability.';
  }
}
window.toggleTheme = toggleTheme;

// ---- Clock ----
function startClock() {
  setInterval(() => {
    const el = document.getElementById('liveClock');
    if (el) el.textContent = new Date().toLocaleTimeString();
  }, 1000);
}

// ---- URL Params ----
function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('success') === 'true') {
    const provider = params.get('connected');
    showToast(`${capitalize(provider || 'Calendar')} connected successfully!`, 'success');
    window.history.replaceState({}, '', '/');
    checkAuthStatus(); // Re-verify auth immediately
  }
  if (params.get('error')) {
    showToast(`Connection failed: ${params.get('error')}`, 'error');
    window.history.replaceState({}, '', '/');
  }
}

// ---- Auth ----
async function checkAuthStatus() {
  const overlay = document.getElementById('loadingOverlay');
  if (currentUser) overlay.style.display = 'flex';

  try {
    const res = await fetch('/api/auth/status', { credentials: 'include' });
    const data = await res.json();
    
    if (data.authenticated && data.user) {
      currentUser = data.user;
      showAuthenticatedUI();
      fetchDashboardData();
    } else {
      currentUser = null;
      showUnauthenticatedUI();
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    showUnauthenticatedUI();
  } finally {
    overlay.style.display = 'none';
  }
}

function showAuthenticatedUI() {
  document.getElementById('loadingOverlay').style.display = 'none';
  document.getElementById('landingPage').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  
  const userInfo = document.getElementById('userInfo');
  const logoutBtn = document.getElementById('logoutBtn');
  const userAvatar = document.getElementById('userAvatar');
  const userEmail = document.getElementById('userEmail');
  
  userInfo.style.display = 'flex';
  logoutBtn.style.display = 'inline-flex';
  userAvatar.textContent = (currentUser.displayName || currentUser.email || 'U')[0].toUpperCase();
  userEmail.textContent = currentUser.email || '';
  
  document.getElementById('newEventBtn').style.display = 'inline-flex';
  document.getElementById('assistantLink').style.display = 'inline-flex';

  if (currentUser.isAdmin) {
    document.getElementById('adminLink').style.display = 'inline-flex';
  }

  if (currentUser.timezone) {
    document.getElementById('timezoneSelect').value = currentUser.timezone;
  }
}

function showUnauthenticatedUI() {
  document.getElementById('loadingOverlay').style.display = 'none';
  document.getElementById('landingPage').style.display = 'block';
  document.getElementById('authSection').style.display = 'block';
  document.getElementById('app').style.display = 'none';
  document.getElementById('userInfo').style.display = 'none';
  document.getElementById('logoutBtn').style.display = 'none';
}

// ---- Connection Actions ----
function connectGoogle() {
  window.location.href = '/api/auth/google';
}
window.connectGoogle = connectGoogle;

function connectMicrosoft() {
  window.location.href = '/api/auth/microsoft';
}
window.connectMicrosoft = connectMicrosoft;

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'include'
  });
  const data = await res.json();
  if (data.success) {
    showToast('Welcome back!', 'success');
    checkAuthStatus();
  } else {
    showToast(data.error || 'Login failed', 'error');
  }
}
window.handleLogin = handleLogin;

async function handleRegister(e) {
  e.preventDefault();
  const displayName = document.getElementById('regName').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, email, password }),
    credentials: 'include'
  });
  const data = await res.json();
  if (data.success) {
    showToast('Account created!', 'success');
    checkAuthStatus();
  } else {
    showToast(data.error || 'Registration failed', 'error');
  }
}
window.handleRegister = handleRegister;

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  currentUser = null;
  showUnauthenticatedUI();
}
window.logout = logout;

function switchTab(type) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  
  if (!loginForm || !registerForm) return;

  if (type === 'login') {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
  } else {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    tabLogin.classList.remove('active');
    tabRegister.classList.add('active');
  }
}
window.switchTab = switchTab;

function refreshData() {
  showToast('Refreshing data...');
  fetchDashboardData();
}
window.refreshData = refreshData;

async function updateTimezone(tz) {
  try {
    const res = await fetch('/api/user/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: tz }),
      credentials: 'include'
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Timezone updated to ${tz}`);
      fetchDashboardData();
    } else {
      showToast(data.error || 'Failed to update timezone', 'error');
    }
  } catch (e) {
    showToast('Failed to update timezone', 'error');
  }
}
window.updateTimezone = updateTimezone;

// ---- Dashboard Data ----
async function fetchDashboardData() {
  if (!currentUser) return;
  try {
    const [statsRes, eventsRes] = await Promise.all([
      fetch('/api/dashboard/stats', { credentials: 'include' }),
      fetch('/api/calendar/events', { credentials: 'include' })
    ]);
    if (statsRes.ok) {
      const data = await statsRes.json();
      if (data.success) {
        updateStats(data.stats);
        updateAccounts(currentUser.identities || []);
        updateActivity(data.recentActivity || []);
        fetchWebhookStatus();
      }
    }
    if (eventsRes.ok) {
      const eventData = await eventsRes.json();
      if (eventData.success) {
        updateMeetings(eventData.events || []);
      }
    }
  } catch (e) {
    console.error('Fetch error:', e);
  }
}

function updateStats(stats) {
  document.getElementById('statCalendars').textContent = stats.connectedCalendars || 0;
  document.getElementById('statEvents').textContent = stats.totalEvents || 0;
  document.getElementById('statShadows').textContent = stats.activeShadowBlocks || 0;
  document.getElementById('statSyncs').textContent = stats.syncsToday || 0;
}

function updateAccounts(identities) {
  const container = document.getElementById('accountsList');
  if (!identities.length) {
    container.innerHTML = '<div class="empty-state">No calendars connected.</div>';
    return;
  }
  container.innerHTML = identities.map(id => `
    <div class="identity-item">
      <div class="identity-info">
        <div class="identity-email">${escapeHtml(id.providerEmail)}</div>
        <div class="identity-meta">${id.providerType} · ${escapeHtml(id.calendarName || 'Calendar')}</div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="disconnect('${id.id}')">Disconnect</button>
    </div>
  `).join('');
}

function updateActivity(logs) {
  const container = document.getElementById('activityFeed');
  if (!logs.length) {
    container.innerHTML = '<div class="empty-state">No recent activity.</div>';
    return;
  }
  container.innerHTML = logs.slice(0, 8).map(log => `
    <div class="activity-item">
      <div class="activity-dot ${log.status === 'COMPLETED' ? 'synced' : 'error'}"></div>
      <div class="activity-content">
        <div class="activity-text"><strong>${log.action}</strong> - ${log.status}</div>
        <div class="activity-time">${new Date(log.startedAt).toLocaleTimeString()}</div>
      </div>
    </div>
  `).join('');
}

// ---- Calendar Logic ----
function updateMeetings(events) {
  const container = document.getElementById('calendar');
  if (!container) return;
  
  if (!fullCalendarInstance) {
    fullCalendarInstance = new FullCalendar.Calendar(container, {
      initialView: 'timeGridWeek',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' },
      height: 600,
      eventContent: function(arg) {
        let el = document.createElement('div');
        const isSystem = arg.event.extendedProps?.isSystemGenerated;
        if (isBossMode && !isSystem) {
          el.innerHTML = '<strong>Busy</strong>';
        } else {
          el.innerHTML = arg.event.title;
        }
        el.style.fontSize = '0.85em';
        return { domNodes: [el] };
      }
    });
    fullCalendarInstance.render();
  }

  const fcEvents = events.map(event => ({
    id: event.id,
    title: (event.isSystemGenerated ? '🛡️ ' : '') + (event.title || 'Untitled'),
    start: event.startTime,
    end: event.endTime,
    backgroundColor: event.isSystemGenerated ? 'var(--accent-emerald)' : 'var(--accent-indigo)',
    borderColor: 'transparent',
    extendedProps: { isSystemGenerated: event.isSystemGenerated }
  }));

  fullCalendarInstance.removeAllEvents();
  fullCalendarInstance.addEventSource(fcEvents);
}

// ---- Actions ----
async function triggerSync() {
  showToast('Sync started...', 'success');
  animatePipeline();
  await fetch('/api/calendar/sync', { method: 'POST', credentials: 'include' });
  setTimeout(fetchDashboardData, 2000);
}
window.triggerSync = triggerSync;

async function disconnect(id) {
  if (!confirm('Disconnect this calendar?')) return;
  await fetch(`/api/auth/disconnect/${id}`, { method: 'POST', credentials: 'include' });
  checkAuthStatus();
}
window.disconnect = disconnect;

// ---- Animations ----
function animatePipeline() {
  const stages = ['pipeWebhook','pipeFetch','pipeGuard','pipeUpsert','pipeConflict','pipeShadow'];
  stages.forEach((id, i) => {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.classList.add('active');
      setTimeout(() => { if (el) el.classList.remove('active'); }, 1000);
    }, i * 300);
  });
}

// ---- Command Palette ----
let paletteSearchTimeout;
function handlePaletteSearch(q) {
  clearTimeout(paletteSearchTimeout);
  if (!q) return;
  paletteSearchTimeout = setTimeout(async () => {
    const res = await fetch(`/api/calendar/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
    const data = await res.json();
    renderPaletteResults(data.events || []);
  }, 300);
}
window.handlePaletteSearch = handlePaletteSearch;

function renderPaletteResults(events) {
  const container = document.getElementById('paletteResults');
  container.innerHTML = events.map(ev => `
    <div class="palette-item" onclick="navigateToEvent('${ev.startTime}')">
      <div class="palette-item-title">${ev.summary || 'Meeting'}</div>
      <div class="palette-item-meta">${new Date(ev.startTime).toLocaleString()}</div>
    </div>
  `).join('');
}

function openCommandPalette() {
  document.getElementById('commandPalette').style.display = 'flex';
  document.getElementById('paletteInput').focus();
}

function closeCommandPalette(e) {
  if (e === 'esc' || e.target.id === 'commandPalette') {
    document.getElementById('commandPalette').style.display = 'none';
  }
}
window.closeCommandPalette = closeCommandPalette;

function navigateToEvent(dateStr) {
  if (fullCalendarInstance) {
    fullCalendarInstance.gotoDate(dateStr);
    fullCalendarInstance.changeView('timeGridDay');
  }
  closeCommandPalette('esc');
}
window.navigateToEvent = navigateToEvent;

// ---- Boss Mode ----
function toggleBossMode() {
  isBossMode = document.getElementById('bossModeToggle').checked;
  if (fullCalendarInstance) fullCalendarInstance.refetchEvents();
  showToast(`Boss Mode ${isBossMode ? 'Enabled' : 'Disabled'}`);
}
window.toggleBossMode = toggleBossMode;

async function purgeShadowBlocks() {
  if (!confirm('Purge all shadow blocks?')) return;
  await fetch('/api/calendar/shadow-blocks/cleanup', { method: 'POST', credentials: 'include' });
  fetchDashboardData();
}
window.purgeShadowBlocks = purgeShadowBlocks;

// ---- Webhook Health ----
async function fetchWebhookStatus() {
  const container = document.getElementById('webhookHealthList');
  const res = await fetch('/api/calendar/webhooks/status', { credentials: 'include' });
  const data = await res.json();
  if (!data.health?.length) {
    container.innerHTML = '<p>No active webhooks.</p>';
    return;
  }
  container.innerHTML = data.health.map(h => `
    <div class="webhook-item">
      <span>${h.provider} - ${h.email}</span>
      <span class="status-dot ${h.status}"></span>
    </div>
  `).join('');
}
window.fetchWebhookStatus = fetchWebhookStatus;

// ---- Event Creation Modal ----
function openEventModal() {
  document.getElementById("eventModal").style.display = "flex";
  const select = document.getElementById("eventIdentity");
  select.innerHTML = (currentUser.identities || []).map(id => 
    `<option value="${id.id}">${id.providerType}: ${id.providerEmail}</option>`
  ).join("");
}
window.openEventModal = openEventModal;

function closeEventModal(e) {
  if (e === "esc" || e.target.id === "eventModal") {
    document.getElementById("eventModal").style.display = "none";
  }
}
window.closeEventModal = closeEventModal;

async function handleCreateEvent(e) {
  e.preventDefault();
  const payload = {
    identityId: document.getElementById("eventIdentity").value,
    summary: document.getElementById("eventSummary").value,
    startTime: document.getElementById("eventStart").value,
    endTime: document.getElementById("eventEnd").value
  };
  await fetch("/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include"
  });
  closeEventModal("esc");
  fetchDashboardData();
}
window.handleCreateEvent = handleCreateEvent;

// ---- Utilities ----
function showToast(msg, type='success') {
  console.log(`[${type}] ${msg}`);
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function startPolling() {
  setInterval(() => { if (currentUser) fetchDashboardData(); }, 30000);
}

// ---- Reset Password Handlers ----
function openResetModal() {
  document.getElementById('resetModal').style.display = 'flex';
  document.getElementById('resetRequestStep').style.display = 'block';
  document.getElementById('resetFinalStep').style.display = 'none';
}
window.openResetModal = openResetModal;

function closeResetModal(e) {
  if (e === 'esc' || e.target.id === 'resetModal') {
    document.getElementById('resetModal').style.display = 'none';
  }
}
window.closeResetModal = closeResetModal;

async function handleForgotPassword() {
  const email = document.getElementById('resetEmail').value;
  if (!email) return showToast('Please enter your email', 'error');
  
  try {
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    document.getElementById('resetRequestStep').style.display = 'none';
    document.getElementById('resetFinalStep').style.display = 'block';
  } catch (e) {
    showToast('Failed to send link', 'error');
  }
}
window.handleForgotPassword = handleForgotPassword;

async function handleResetPassword() {
  const email = document.getElementById('resetEmail').value;
  const newPassword = document.getElementById('newPassword').value;
  
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, newPassword })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Password updated! You can now log in.', 'success');
      closeResetModal('esc');
    } else {
      showToast(data.error || 'Reset failed', 'error');
    }
  } catch (e) {
    showToast('Reset failed', 'error');
  }
}
window.handleResetPassword = handleResetPassword;

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openCommandPalette(); }
  if (e.key === 'Escape') {
    closeCommandPalette('esc');
    closeEventModal('esc');
    closeResetModal('esc');
  }
});
