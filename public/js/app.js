/**
 * CalendarSync AI - Dashboard JavaScript
 */

// ---- State ----
let currentUser = null;
let pollInterval = null;

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  checkUrlParams();
  checkAuthStatus();
  startPolling();
});

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
  try {
    const res = await fetch('/api/auth/status', { credentials: 'include' });
    const data = await res.json();
    if (data.authenticated && data.user) {
      currentUser = data.user;
      showAuthenticatedUI();
      fetchDashboardData();
    } else {
      showUnauthenticatedUI();
    }
  } catch {
    showUnauthenticatedUI();
  }
}

function showAuthenticatedUI() {
  const userInfo = document.getElementById('userInfo');
  const logoutBtn = document.getElementById('logoutBtn');
  const userAvatar = document.getElementById('userAvatar');
  const userEmail = document.getElementById('userEmail');
  
  userInfo.style.display = 'flex';
  logoutBtn.style.display = 'inline-flex';
  userAvatar.textContent = (currentUser.displayName || currentUser.email || 'U')[0].toUpperCase();
  userEmail.textContent = currentUser.email || '';
}

function showUnauthenticatedUI() {
  document.getElementById('userInfo').style.display = 'none';
  document.getElementById('logoutBtn').style.display = 'none';
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    currentUser = null;
    showUnauthenticatedUI();
    resetDashboard();
    showToast('Logged out successfully', 'success');
  } catch {
    showToast('Logout failed', 'error');
  }
}

// ---- Dashboard Data ----
async function fetchDashboardData() {
  if (!currentUser) return;
  try {
    const res = await fetch('/api/dashboard/stats', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.success) {
      updateStats(data.stats);
      updateAccounts(currentUser.identities || []);
      updateActivity(data.recentActivity || []);
      updateStatus(data.stats);
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
    const dotClass = getDotClass(log.action, log.status);
    const text = getLogText(log);
    return `<div class="activity-item">
      <span class="activity-dot ${dotClass}"></span>
      <div>
        <div class="activity-text">${text}</div>
        <div class="activity-time">${timeAgo(log.startedAt)}</div>
      </div>
    </div>`;
  }).join('');
}

function updateStatus(stats) {
  const statusText = document.getElementById('statusText');
  if (stats.connectedCalendars > 0) {
    statusText.textContent = `${stats.connectedCalendars} calendar${stats.connectedCalendars > 1 ? 's' : ''} synced`;
  }
}

function resetDashboard() {
  ['statCalendars','statEvents','statShadows','statSyncs'].forEach(id => {
    document.getElementById(id).textContent = '0';
  });
  document.getElementById('accountsList').innerHTML = '<div class="empty-state"><div class="empty-icon">🔌</div><p>No calendars connected.</p></div>';
  document.getElementById('activityFeed').innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No activity yet.</p></div>';
  document.getElementById('statusText').textContent = 'System Ready';
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

// ---- Toast Notifications ----
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
