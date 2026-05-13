/**
 * CalendarSync AI - Dashboard JavaScript
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

// ---- Theme ----
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
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
  console.log('Checking auth status...');
  try {
    const res = await fetch('/api/auth/status', { credentials: 'include' });
    const data = await res.json();
    console.log('Auth check result:', data);
    
    // Always hide the loading spinner first
    document.getElementById('loadingOverlay').style.display = 'none';
    
    if (data.authenticated && data.user) {
      currentUser = data.user;
      hideAuthUI();
      showAuthenticatedUI();
      fetchDashboardData();
    } else {
      showUnauthenticatedUI();
      showAuthUI();
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    document.getElementById('loadingOverlay').style.display = 'none';
    showUnauthenticatedUI();
    showAuthUI();
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
  const displayName = document.getElementById('regName').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');

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
  document.getElementById('app').style.display = 'block';
  const userInfo = document.getElementById('userInfo');
  const logoutBtn = document.getElementById('logoutBtn');
  const userAvatar = document.getElementById('userAvatar');
  const userEmail = document.getElementById('userEmail');
  
  userInfo.style.display = 'flex';
  logoutBtn.style.display = 'inline-flex';
  userAvatar.textContent = (currentUser.displayName || currentUser.email || 'U')[0].toUpperCase();
  userEmail.textContent = currentUser.email || '';
  
  if (currentUser.timezone) {
    document.getElementById('timezoneSelect').value = currentUser.timezone;
  }
}

function showUnauthenticatedUI() {
  document.getElementById('app').style.display = 'none';
  document.getElementById('userInfo').style.display = 'none';
  document.getElementById('logoutBtn').style.display = 'none';
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    currentUser = null;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    showUnauthenticatedUI();
    resetDashboard();
    showToast('Logged out successfully', 'success');
    showAuthUI();
  } catch {
    showToast('Logout failed', 'error');
  }
}

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
        updateSyncStatus('System Online', 'emerald');
        updateLastUpdated();
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
    const providerLabel = id.providerType.replace('_', ' ');
    const icon = isGoogle ? 'google' : 'microsoft';
    const emoji = isGoogle ? '🔴' : '🔵';
    const syncText = id.lastSyncedAt ? `Synced ${timeAgo(id.lastSyncedAt)}` : 'Never synced';
    
    return `<div class="identity-item">
      <div class="identity-info">
        <div class="identity-icon ${icon}">${emoji}</div>
        <div>
          <div class="identity-email">${id.providerEmail}</div>
          <div class="identity-meta">${providerLabel} · ${id.calendarName || 'Calendar'} · ${syncText}</div>
        </div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="disconnect('${id.id}')">Disconnect</button>
    </div>`;
  }).join('');
}

function updateActivity(logs) {
  const container = document.getElementById('activityFeed');
  if (!logs.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No sync activity yet.</p></div>';
    return;
  }

  container.innerHTML = logs.slice(0, 8).map(log => {
    return `<div class="activity-item">
      <div class="activity-dot ${log.status === 'COMPLETED' ? 'created' : 'error'}"></div>
      <div class="activity-content">
        <div class="activity-text"><strong>${log.action.replace(/_/g, ' ')}</strong> - ${log.status}</div>
        <div class="activity-time">${new Date(log.startedAt).toLocaleString()}</div>
      </div>
    </div>`;
  }).join('');
}


function resetDashboard() {
  ['statCalendars','statEvents','statShadows','statSyncs'].forEach(id => {
    document.getElementById(id).textContent = '0';
  });
  document.getElementById('accountsList').innerHTML = '<div class="empty-state"><div class="empty-icon">🔌</div><p>No calendars connected.</p></div>';
  document.getElementById('activityFeed').innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No activity yet.</p></div>';
  document.getElementById('meetingsList').innerHTML = '<div class="empty-state"><div class="empty-icon">🗓️</div><p>No meetings found or calendars not connected.</p></div>';
  document.getElementById('statusText').textContent = 'System Ready';
}

function updateMeetings(events) {
  const container = document.getElementById('meetingsList');
  if (!events.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🗓️</div><p>No upcoming meetings found.</p></div>';
    return;
  }
  
  const now = new Date();
  // Filter out past events and sort
  const upcoming = events
    .filter(e => new Date(e.endTime) > now)
    .sort((a,b) => new Date(a.startTime) - new Date(b.startTime));
    
  if(!upcoming.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🗓️</div><p>No upcoming meetings found.</p></div>';
    return;
  }

  container.innerHTML = upcoming.map(event => {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    const isGoogle = event.identity?.providerType?.startsWith('GOOGLE');
    const color = isGoogle ? '#ea4335' : '#0078d4';
    
    return `
      <div class="meeting-card ${isSystem ? 'system-gen' : ''}">
        <div class="meeting-time-box">
          <span class="m-date">${startDate}</span>
          <span class="m-time">${startTime}</span>
        </div>
        <div class="meeting-info">
          <div class="meeting-title">${e.title}</div>
          <div class="meeting-details">
            <span class="provider-badge ${e.identity?.providerType?.toLowerCase().includes('google') ? 'google' : 'microsoft'}">
              ${e.identity?.providerType?.toLowerCase().includes('google') ? 'G' : 'M'}
            </span>
            ${e.location ? `<span class="m-loc">📍 ${e.location}</span>` : ''}
            ${isSystem ? '<span class="sync-badge">🛡️ Protected Block</span>' : '<span class="sync-badge">✅ Synced</span>'}
          </div>
        </div>
      </div>
    `;
  }).join('');
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
