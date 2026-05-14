/**
 * OpenCalendar - Dashboard JavaScript
 */

// ---- State ----
let currentUser = null;
let pollInterval = null;

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

// ---- URL Params (post-OAuth redirect) ----
function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('success') === 'true') {
    const provider = params.get('connected');
    showToast(`${capitalize(provider || 'Calendar')} connected successfully!`, 'success');
    window.history.replaceState({}, '', '/');
  }
  if (params.get('error')) {
    showToast(`Connection failed: ${params.get('error')}`, 'error');
    window.history.replaceState({}, '', '/');
  }
}

// ---- Auth ----
async function checkAuthStatus() {
  const overlay = document.getElementById('loadingOverlay');
  // Only show overlay if we were already in the app, otherwise keep it hidden to show landing page
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

// ---- Auth UI Helpers ----
function showAuthUI() {
  document.getElementById('authSection').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function hideAuthUI() {
  document.getElementById('authSection').style.display = 'none';
}

function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabRegister').classList.toggle('active', !isLogin);
  document.getElementById('loginForm').style.display = isLogin ? 'flex' : 'none';
  document.getElementById('registerForm').style.display = isLogin ? 'none' : 'flex';
}
window.switchTab = switchTab;

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (data.success) {
      showToast('Welcome back!', 'success');
      hideAuthUI();
      checkAuthStatus();
    } else {
      showToast(data.error || 'Login failed', 'error');
    }
  } catch (error) {
    showToast('Login failed', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
}
window.handleLogin = handleLogin;

async function handleRegister(e) {
  e.preventDefault();
  const displayName = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');

  // Frontend validation
  if (!displayName) {
    return showToast('Display name is required', 'error');
  }
  if (!email || !/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) {
    return showToast('Please enter a valid email address', 'error');
  }
  if (password.length < 8) {
    return showToast('Password must be at least 8 characters', 'error');
  }
  if (!/[A-Z]/.test(password)) {
    return showToast('Password must contain at least one uppercase letter', 'error');
  }
  if (!/[0-9]/.test(password)) {
    return showToast('Password must contain at least one number', 'error');
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account...';

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, email, password }),
      credentials: 'include'
    });
    const data = await res.json();
    if (data.success) {
      showToast('Account created!', 'success');
      hideAuthUI();
      checkAuthStatus();
    } else {
      showToast(data.error || 'Registration failed', 'error');
    }
  } catch (error) {
    showToast('Registration failed', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
  }
}
window.handleRegister = handleRegister;

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
  window.scrollTo(0, 0); // Reset scroll to top
}

async function logout() {
  try {
    // Attempt to clear cookie on server
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (error) {
    console.error('Logout request failed:', error);
  } finally {
    // Always clear local state and show landing page
    currentUser = null;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    resetDashboard();
    showUnauthenticatedUI();
    showToast('Logged out successfully', 'success');
  }
}
window.logout = logout;

// ---- Dashboard Data ----
// ---- Calendar Integrations ----
function connectGoogle() {
  window.location.href = '/api/auth/google';
}
window.connectGoogle = connectGoogle;

function connectMicrosoft() {
  window.location.href = '/api/auth/microsoft';
}
window.connectMicrosoft = connectMicrosoft;

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
        updateSyncStatus('System Online', 'emerald');
        updateLastUpdated();
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
    console.error('Dashboard fetch error:', e);
  }
}

function updateStats(stats) {
  animateNumber('statCalendars', stats.connectedCalendars || 0);
  animateNumber('statEvents', stats.totalEvents || 0);
  animateNumber('statShadows', stats.activeShadowBlocks || 0);
  animateNumber('statSyncs', stats.syncsToday || 0);
}

function animateNumber(elId, target) {
  const el = document.getElementById(elId);
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  const duration = 600;
  const start = performance.now();
  
  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(current + (target - current) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function updateSyncStatus(text, colorVar) {
  const statusText = document.getElementById('syncStatus');
  const dot = document.querySelector('.navbar-status .status-dot');
  if (statusText) statusText.textContent = text;
  if (dot) dot.style.background = `var(--accent-${colorVar})`;
}

function updateLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (el) el.textContent = `Last sync: ${new Date().toLocaleTimeString()}`;
}

function updateAccounts(identities) {
  const container = document.getElementById('accountsList');
  if (!identities.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔌</div><p>No calendars connected yet.</p></div>';
    return;
  }

  container.innerHTML = identities.map(id => {
    const isGoogle = id.providerType.startsWith('GOOGLE');
    const providerLabel = escapeHtml(id.providerType.replace('_', ' '));
    const icon = isGoogle ? 'google' : 'microsoft';
    const emoji = isGoogle ? '🔴' : '🔵';
    const syncText = id.lastSyncedAt ? `Synced ${timeAgo(id.lastSyncedAt)}` : 'Never synced';
    const safeEmail = escapeHtml(id.providerEmail);
    const safeCalName = escapeHtml(id.calendarName || 'Calendar');
    
    return `<div class="identity-item">
      <div class="identity-info">
        <div class="identity-icon ${icon}">${emoji}</div>
        <div>
          <div class="identity-email">${safeEmail}</div>
          <div class="identity-meta">${providerLabel} · ${safeCalName} · ${syncText}</div>
        </div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="disconnect('${id.id}')">Disconnect</button>
    </div>`;
  }).join('');
}

let currentActivityPage = 0;
const ACTIVITY_PAGE_SIZE = 8;

function updateActivity(logs) {
  const container = document.getElementById('activityFeed');
  if (!logs.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No sync activity yet.</p></div>';
    return;
  }

  const startIdx = currentActivityPage * ACTIVITY_PAGE_SIZE;
  const pageLogs = logs.slice(startIdx, startIdx + ACTIVITY_PAGE_SIZE);

  let html = pageLogs.map(log => {
    return `<div class="activity-item">
      <div class="activity-dot ${log.status === 'COMPLETED' ? 'created' : 'error'}"></div>
      <div class="activity-content">
        <div class="activity-text"><strong>${log.action.replace(/_/g, ' ')}</strong> - ${log.status}</div>
        <div class="activity-time">${new Date(log.startedAt).toLocaleString()}</div>
      </div>
    </div>`;
  }).join('');

  // Pagination controls
  if (logs.length > ACTIVITY_PAGE_SIZE) {
    html += `<div style="display:flex; justify-content:space-between; margin-top:16px;">
      <button class="btn btn-ghost btn-sm" onclick="changeActivityPage(-1, ${logs.length})" ${currentActivityPage === 0 ? 'disabled' : ''}>← Prev</button>
      <span style="font-size:0.75rem; color:var(--text-muted); align-self:center;">Page ${currentActivityPage + 1}</span>
      <button class="btn btn-ghost btn-sm" onclick="changeActivityPage(1, ${logs.length})" ${startIdx + ACTIVITY_PAGE_SIZE >= logs.length ? 'disabled' : ''}>Next →</button>
    </div>`;
  }

  container.innerHTML = html;
}

window.changeActivityPage = function(delta, totalLength) {
  currentActivityPage += delta;
  if (currentActivityPage < 0) currentActivityPage = 0;
  if (currentActivityPage * ACTIVITY_PAGE_SIZE >= totalLength) currentActivityPage--;
  // Re-render activity using cached logs or triggering fetch
  if (currentUser) fetchDashboardData();
};


function resetDashboard() {
  ['statCalendars','statEvents','statShadows','statSyncs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  });
  const accountsList = document.getElementById('accountsList');
  if (accountsList) accountsList.innerHTML = '<div class="empty-state"><div class="empty-icon">🔌</div><p>No calendars connected.</p></div>';
  const activityFeed = document.getElementById('activityFeed');
  if (activityFeed) activityFeed.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No activity yet.</p></div>';
  const meetingsList = document.getElementById('meetingsList');
  if (meetingsList) meetingsList.innerHTML = '<div class="empty-state"><div class="empty-icon">🗓️</div><p>No meetings found or calendars not connected.</p></div>';
  const syncStatus = document.getElementById('syncStatus');
  if (syncStatus) syncStatus.textContent = 'System Ready';
}

let fullCalendarInstance = null;

function updateMeetings(events) {
  const container = document.getElementById('calendar');
  if (!container) return;
  
  const now = new Date();
  // Filter out past events and sort
  const upcoming = events.filter(e => new Date(e.endTime) >= now)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  const userTz = document.getElementById('timezoneSelect').value || 'local';

  if (!fullCalendarInstance) {
    fullCalendarInstance = new FullCalendar.Calendar(container, {
      timeZone: userTz === 'UTC' ? 'UTC' : userTz,
      initialView: 'timeGridWeek',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'timeGridWeek,timeGridDay,dayGridMonth'
      },
      height: 600,
      slotMinTime: '06:00:00',
      slotMaxTime: '21:00:00',
      slotDuration: '00:30:00',
      expandRows: true,
      allDaySlot: false,
      nowIndicator: true,
      scrollTime: '08:00:00',
      stickyHeaderDates: true,
      events: [],
      eventContent: function(arg) {
        let italicEl = document.createElement('div');
        const isSystem = arg.event.extendedProps?.isSystemGenerated;
        
        // Boss Mode Logic
        if (isBossMode && !isSystem) {
          italicEl.innerHTML = '<strong>Busy</strong>';
        } else {
          italicEl.innerHTML = arg.event.title;
        }
        
        italicEl.style.fontSize = '0.85em';
        italicEl.style.whiteSpace = 'normal';
        italicEl.style.overflow = 'hidden';
        let arrayOfDomNodes = [ italicEl ]
        return { domNodes: arrayOfDomNodes }
      }
    });
    fullCalendarInstance.render();
  }

  const fcEvents = upcoming.map(event => {
    const isGoogle = event.identity?.providerType?.startsWith('GOOGLE');
    const isSystem = event.isSystemGenerated || false;
    
    let bgColor = 'var(--surface-light)';
    let textColor = 'var(--text-primary)';
    let titlePrefix = '';
    
    if (isSystem) {
      bgColor = 'var(--accent-emerald)';
      titlePrefix = '🛡️ ';
    } else if (isGoogle) {
      bgColor = 'var(--accent-cyan)';
      titlePrefix = 'G | ';
    } else {
      bgColor = 'var(--accent-indigo)';
      titlePrefix = 'M | ';
    }

    return {
      id: event.id,
      title: titlePrefix + (event.title || 'Untitled'),
      start: event.startTime,
      end: event.endTime,
      backgroundColor: bgColor,
      borderColor: 'transparent',
      textColor: textColor,
      extendedProps: { isSystemGenerated: isSystem }
    };
  });

  fullCalendarInstance.removeAllEvents();
  fullCalendarInstance.addEventSource(fcEvents);
}

// ---- Actions ----
async function triggerSync() {
  if (!currentUser) return showToast('Please connect a calendar first', 'error');
  try {
    showToast('Sync started...', 'success');
    await fetch('/api/calendar/sync', { method: 'POST', credentials: 'include' });
    setTimeout(fetchDashboardData, 2000);
  } catch {
    showToast('Sync failed', 'error');
  }
}

async function disconnect(identityId) {
  if (!confirm('Disconnect this calendar? Active shadow blocks will be cancelled.')) return;
  try {
    const res = await fetch(`/api/auth/disconnect/${identityId}`, { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      checkAuthStatus();
    } else {
      showToast('Disconnect failed', 'error');
    }
  } catch {
    showToast('Disconnect failed', 'error');
  }
}

async function refreshData() {
  await checkAuthStatus();
  showToast('Data refreshed', 'success');
}

// ---- Polling ----
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    if (currentUser) fetchDashboardData();
  }, 30000);
}

// ---- Helpers ----
function getDotClass(action, status) {
  if (status === 'FAILED') return 'error';
  if (action.includes('CREATED')) return 'created';
  if (action.includes('DELETED')) return 'deleted';
  return 'synced';
}

function getLogText(log) {
  const actions = {
    WEBHOOK_RECEIVED: '<strong>Webhook</strong> received',
    EVENT_CREATED: '<strong>Event</strong> synced',
    EVENT_UPDATED: '<strong>Event</strong> updated',
    EVENT_DELETED: '<strong>Event</strong> deleted',
    SHADOW_CREATED: '<strong>Shadow block</strong> created',
    SHADOW_DELETED: '<strong>Shadow block</strong> removed',
    CONFLICT_DETECTED: '<strong>Conflict</strong> detected',
    TOKEN_REFRESHED: '<strong>Token</strong> refreshed',
    FULL_SYNC: '<strong>Full sync</strong> completed',
    LOOP_PREVENTED: '<strong>Loop</strong> prevented',
  };
  let text = actions[log.action] || `<strong>${log.action}</strong>`;
  if (log.providerType) text += ` · ${log.providerType.replace('_',' ')}`;
  if (log.status === 'FAILED') text += ' · <span style="color:var(--accent-rose)">FAILED</span>';
  return text;
}

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`;
  return `${Math.floor(seconds/86400)}d ago`;
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

async function updateTimezone(timezone) {
  try {
    const res = await fetch('/api/user/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone }),
      credentials: 'include'
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Timezone updated to ${timezone}`, 'success');
      if (fullCalendarInstance) {
        fullCalendarInstance.setOption('timeZone', timezone === 'UTC' ? 'UTC' : timezone);
      }
    }
  } catch (error) {
    showToast('Failed to update timezone', 'error');
  }
}
window.updateTimezone = updateTimezone;

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${type === 'success' ? '✅' : '❌'} ${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ---- State Machine Animation (visual only) ----
function animateStateMachine(activeState) {
  const states = ['stateIdle','stateWebhook','stateLoopCheck','stateFetch','stateConflict','stateShadow','stateSync'];
  states.forEach(id => document.getElementById(id)?.classList.remove('active'));
  const target = document.getElementById(activeState);
  if (target) target.classList.add('active');
}

// ---- Pipeline Visualizer Animation ----
function animatePipeline() {
  const stages = ['pipeWebhook','pipeFetch','pipeGuard','pipeUpsert','pipeConflict','pipeShadow'];
  const connectors = ['connWebhook','connFetch','connGuard','connUpsert','connConflict'];

  // Reset all
  stages.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active','done'); el.textContent = stages.indexOf(id) + 1; }
  });
  connectors.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });

  // Stagger through stages
  stages.forEach((id, i) => {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      // Mark previous as done
      if (i > 0) {
        const prev = document.getElementById(stages[i-1]);
        if (prev) { prev.classList.remove('active'); prev.classList.add('done'); prev.textContent = '✓'; }
        const conn = document.getElementById(connectors[i-1]);
        if (conn) conn.classList.add('active');
      }
      el.classList.add('active');
      // Final stage
      if (i === stages.length - 1) {
        setTimeout(() => {
          el.classList.remove('active'); el.classList.add('done'); el.textContent = '✓';
        }, 400);
      }
    }, i * 350);
  });
}

// Run pipeline animation on sync
const originalTriggerSync = triggerSync;
// Override to add visual pipeline
async function triggerSyncWithPipeline() {
  if (!currentUser) return showToast('Please connect a calendar first', 'error');
  try {
    showToast('Sync started...', 'success');
    animatePipeline();
    await fetch('/api/calendar/sync', { method: 'POST', credentials: 'include' });
    setTimeout(fetchDashboardData, 2000);
  } catch {
    showToast('Sync failed', 'error');
  }
}
window.triggerSync = triggerSyncWithPipeline;

// ---- Command Palette ----
let paletteSearchTimeout;
function handlePaletteSearch(q) {
  clearTimeout(paletteSearchTimeout);
  if (!q) return document.getElementById('paletteResults').innerHTML = '<div class="empty-state">Start typing to search...</div>';
  
  paletteSearchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`/api/calendar/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
      const data = await res.json();
      renderPaletteResults(data.events || []);
    } catch (e) {
      console.error('Search failed', e);
    }
  }, 300);
}

function renderPaletteResults(events) {
  const container = document.getElementById('paletteResults');
  if (!events.length) {
    container.innerHTML = '<div class="empty-state">No matches found.</div>';
    return;
  }
  
  container.innerHTML = events.map(ev => `
    <div class="palette-item" onclick="navigateToEvent('${ev.startTime}')">
      <div class="palette-item-info">
        <div class="palette-item-title">${ev.summary || '(No Title)'}</div>
        <div class="palette-item-meta">${new Date(ev.startTime).toLocaleString()}</div>
      </div>
      <div class="palette-item-provider">${ev.identity?.providerType.toUpperCase()}</div>
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

function navigateToEvent(dateStr) {
  if (fullCalendarInstance) {
    fullCalendarInstance.gotoDate(dateStr);
    fullCalendarInstance.changeView('timeGridDay');
  }
  closeCommandPalette('esc');
}

// ---- Boss Mode & Power Tools ----
let isBossMode = false;
function toggleBossMode() {
  isBossMode = document.getElementById('bossModeToggle').checked;
  if (fullCalendarInstance) {
    fullCalendarInstance.refetchEvents(); // This will trigger re-rendering with new content logic
  }
  showToast(`Boss Mode ${isBossMode ? 'Enabled' : 'Disabled'}`, 'success');
}

async function purgeShadowBlocks() {
  if (!confirm('This will delete all cross-calendar "Reserved" blocks. They will be recreated on the next sync. Proceed?')) return;
  try {
    const res = await fetch('/api/calendar/shadow-blocks/cleanup', { method: 'POST', credentials: 'include' });
    const data = await res.json();
    showToast(data.message || 'Shadow blocks purged', 'success');
    fetchDashboardData();
  } catch (e) {
    showToast('Purge failed', 'error');
  }
}

async function fetchWebhookStatus() {
  const container = document.getElementById('webhookHealthList');
  try {
    const res = await fetch('/api/calendar/webhooks/status', { credentials: 'include' });
    const data = await res.json();
    if (!data.health?.length) {
      container.innerHTML = '<div class="empty-state" style="padding: 12px;"><p style="font-size:0.75rem;">No active webhooks.</p></div>';
      return;
    }
    
    container.innerHTML = data.health.map(h => `
      <div class="webhook-item">
        <div class="webhook-provider">
          <span class="provider-badge ${h.provider.toLowerCase()}">${h.provider[0].toUpperCase()}</span>
          <span>${h.email}</span>
        </div>
        <div class="health-indicator">
          <span class="health-dot ${h.status}"></span>
          <span style="color:var(--text-muted)">${h.status}</span>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<p style="color:var(--accent-rose); font-size:0.75rem;">Error loading health.</p>';
  }
}

// Hotkey listener
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openCommandPalette();
  }
  if (e.key === 'Escape') {
    closeCommandPalette('esc');
  }
});

// Update FullCalendar eventContent to respect Boss Mode
const originalEventContent = fullCalendarInstance?.getOption('eventContent');
// I will apply this in a separate chunk to avoid complexity

function scrollToAuth() {
  document.getElementById("authSection").scrollIntoView({ behavior: "smooth" });
}

// ---- Event Creation Modal ----
function openEventModal() {
  const modal = document.getElementById("eventModal");
  modal.style.display = "flex";
  
  // Populate identities dropdown
  const select = document.getElementById("eventIdentity");
  const activeIdentities = currentUser.identities || [];
  select.innerHTML = activeIdentities.map(id => 
    `<option value="${id.id}">${id.providerType}: ${id.providerEmail}</option>`
  ).join("");

  // Set default times (next hour)
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  
  document.getElementById("eventStart").value = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  document.getElementById("eventEnd").value = new Date(end.getTime() - end.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function closeEventModal(e) {
  if (e === "esc" || (e.target && e.target.id === "eventModal")) {
    document.getElementById("eventModal").style.display = "none";
  }
}

async function handleCreateEvent(e) {
  e.preventDefault();
  const submitBtn = document.getElementById("eventSubmitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Creating...";

  const payload = {
    identityId: document.getElementById("eventIdentity").value,
    summary: document.getElementById("eventSummary").value,
    description: document.getElementById("eventDescription").value,
    startTime: document.getElementById("eventStart").value,
    endTime: document.getElementById("eventEnd").value,
    attendees: document.getElementById("eventAttendees").value.split(",").map(s => s.trim()).filter(s => s)
  };

  try {
    const res = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    });
    const data = await res.json();
    if (data.success) {
      showToast("Meeting created & sync triggered!", "success");
      closeEventModal("esc");
      document.getElementById("eventForm").reset();
      fetchDashboardData();
    } else {
      showToast(data.error || "Failed to create event", "error");
    }
  } catch (err) {
    showToast("Event creation failed", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Create & Sync";
  }
}

// Ensure these are globally accessible
window.openEventModal = openEventModal;
window.closeEventModal = closeEventModal;
window.handleCreateEvent = handleCreateEvent;
window.scrollToAuth = scrollToAuth;
window.toggleBossMode = toggleBossMode;
window.purgeShadowBlocks = purgeShadowBlocks;
