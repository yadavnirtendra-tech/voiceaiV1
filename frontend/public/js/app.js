/**
 * OpenCalendar - Dashboard JavaScript (Glassmorphism & Parallax Edition)
 */

// ---- State ----
let currentUser = null;
let fullCalendarInstance = null;
let paletteSearchTimeout = null;

// ---- Initialization ----
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkUrlParams();
  checkAuthStatus();
  
  // Parallax Effect on Mouse Move
  document.addEventListener('mousemove', handleParallax);
  
  // Keyboard Shortcuts
  window.addEventListener('keydown', handleKeyboardShortcuts);
});

function handleParallax(e) {
  const orbs = document.querySelectorAll('.orb');
  const x = (e.clientX / window.innerWidth) - 0.5;
  const y = (e.clientY / window.innerHeight) - 0.5;
  
  orbs.forEach((orb, index) => {
    const factor = (index + 1) * 20;
    orb.style.transform = `translate(${x * factor}px, ${y * factor}px)`;
  });
}

// ---- Theme Management ----
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcons(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcons(next);
}
window.toggleTheme = toggleTheme;

function updateThemeIcons(theme) {
  const btn1 = document.getElementById('themeToggleBtn');
  const btn2 = document.getElementById('landingThemeBtn');
  const icon = theme === 'dark' ? '☀️' : '🌙';
  if (btn1) btn1.textContent = icon;
  if (btn2) btn2.textContent = icon;
}

// ---- Authentication & Routing ----
async function checkAuthStatus() {
  const overlay = document.getElementById('loadingOverlay');
  overlay.style.opacity = '1';
  overlay.style.visibility = 'visible';

  try {
    const res = await fetch('/api/auth/status', { credentials: 'include' });
    const data = await res.json();
    
    if (data.authenticated && data.user) {
      currentUser = data.user;
      showDashboard();
      fetchDashboardData();
      setInterval(fetchDashboardData, 30000); // Polling
    } else {
      currentUser = null;
      showLanding();
    }
  } catch (error) {
    console.error('Auth Check Error:', error);
    showLanding();
  } finally {
    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.style.visibility = 'hidden', 300);
    }, 500);
  }
}

function showLanding() {
  document.getElementById('landingPage').style.display = 'block';
  document.getElementById('app').style.display = 'none';
}

function showDashboard() {
  document.getElementById('landingPage').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  
  document.getElementById('userEmailDisplay').textContent = currentUser.email;
  
  if (currentUser.isAdmin) {
    document.getElementById('adminLink').style.display = 'inline-flex';
  }
  
  if (currentUser.timezone) {
    const tzSelect = document.getElementById('timezoneSelect');
    if (tzSelect) tzSelect.value = currentUser.timezone;
  }
}

function switchTab(type) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  
  if (type === 'login') {
    loginForm.style.display = 'block'; registerForm.style.display = 'none';
    tabLogin.classList.add('active'); tabRegister.classList.remove('active');
  } else {
    loginForm.style.display = 'none'; registerForm.style.display = 'block';
    tabLogin.classList.remove('active'); tabRegister.classList.add('active');
  }
}
window.switchTab = switchTab;

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const res = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }), credentials: 'include'
  });
  const data = await res.json();
  if (data.success) {
    showToast('Login successful!');
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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, email, password }), credentials: 'include'
  });
  const data = await res.json();
  if (data.success) {
    showToast('Account created!');
    checkAuthStatus();
  } else {
    showToast(data.error || 'Registration failed', 'error');
  }
}
window.handleRegister = handleRegister;

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  currentUser = null;
  showLanding();
}
window.logout = logout;

// ---- Providers ----
function connectGoogle() { window.location.href = '/api/auth/google'; }
window.connectGoogle = connectGoogle;
function connectMicrosoft() { window.location.href = '/api/auth/microsoft'; }
window.connectMicrosoft = connectMicrosoft;

function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('success') === 'true') {
    showToast(`${params.get('connected')} Connected Successfully!`);
    window.history.replaceState({}, '', '/');
  }
  if (params.get('error')) {
    showToast(`Error: ${params.get('error')}`, 'error');
    window.history.replaceState({}, '', '/');
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
      }
    }
    
    if (eventsRes.ok) {
      const evData = await eventsRes.json();
      if (evData.success) {
        updateCalendar(evData.events || []);
      }
    }
  } catch (error) {
    console.error('Data Fetch Error:', error);
  }
}
window.refreshData = fetchDashboardData;

function updateStats(stats) {
  document.getElementById('statCalendars').textContent = stats.connectedCalendars || 0;
  document.getElementById('statEvents').textContent = stats.totalEvents || 0;
  document.getElementById('statShadows').textContent = stats.activeShadowBlocks || 0;
  document.getElementById('statSyncs').textContent = stats.syncsToday || 0;
}

function updateAccounts(identities) {
  const container = document.getElementById('accountsList');
  if (!identities.length) {
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">No accounts connected</div>';
    return;
  }
  container.innerHTML = identities.map(id => `
    <div class="list-item">
      <div class="list-info">
        <div class="list-icon">
          <img src="${id.providerType === 'google' ? 'https://www.gstatic.com/images/branding/product/2x/googleg_96dp.png' : 'https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg'}" width="20">
        </div>
        <div>
          <div class="list-title">${escapeHtml(id.providerEmail)}</div>
          <div class="list-meta">${id.providerType.toUpperCase()}</div>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="disconnect('${id.id}')">Disconnect</button>
    </div>
  `).join('');
}

async function disconnect(id) {
  if (!confirm('Disconnect this account?')) return;
  await fetch(`/api/auth/disconnect/${id}`, { method: 'POST', credentials: 'include' });
  checkAuthStatus();
}
window.disconnect = disconnect;

function updateActivity(logs) {
  const container = document.getElementById('activityFeed');
  if (!logs.length) {
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">No activity yet.</div>';
    return;
  }
  container.innerHTML = logs.slice(0,6).map(log => `
    <div class="list-item">
      <div class="list-info">
        <div class="activity-dot ${log.status === 'COMPLETED' ? 'dot-success' : 'dot-error'}"></div>
        <div>
          <div class="list-title">${escapeHtml(log.action)}</div>
          <div class="list-meta">${new Date(log.startedAt).toLocaleTimeString()}</div>
        </div>
      </div>
      <div class="badge ${log.status === 'COMPLETED' ? 'badge-success' : 'badge-danger'}">${log.status}</div>
    </div>
  `).join('');
}

async function updateTimezone(tz) {
  const res = await fetch('/api/user/settings', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timezone: tz }), credentials: 'include'
  });
  if (res.ok) {
    showToast(`Timezone set to ${tz}`);
    fetchDashboardData();
  }
}
window.updateTimezone = updateTimezone;

// ---- Pipeline Animation ----
async function triggerSync() {
  showToast('Initializing synchronization...');
  
  const stages = ['pipeWebhook', 'pipeFetch', 'pipeUpsert', 'pipeShadow'];
  const conns = ['conn1', 'conn2', 'conn3'];
  
  // Animation Sequence
  for(let i=0; i<stages.length; i++) {
    const el = document.getElementById(stages[i]);
    if(el) el.classList.add('active');
    
    if(i < conns.length) {
      setTimeout(() => {
        const c = document.getElementById(conns[i]);
        if(c) c.classList.add('active');
      }, 300);
    }
    
    await new Promise(r => setTimeout(r, 800));
    if(el) el.classList.remove('active');
    if(i < conns.length) {
      const c = document.getElementById(conns[i]);
      if(c) c.classList.remove('active');
    }
  }

  await fetch('/api/calendar/sync', { method: 'POST', credentials: 'include' });
  fetchDashboardData();
  showToast('Synchronization complete!');
}
window.triggerSync = triggerSync;

// ---- Calendar System ----
function updateCalendar(events) {
  const container = document.getElementById('calendar');
  if (!container) return;
  
  if (!fullCalendarInstance) {
    fullCalendarInstance = new FullCalendar.Calendar(container, {
      initialView: 'timeGridWeek',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' },
      height: 600,
      allDaySlot: false,
      slotMinTime: "06:00:00",
      slotMaxTime: "22:00:00",
      eventContent: (arg) => {
        return { html: `<div style="font-size:0.8rem; font-weight:600; padding:2px;">${arg.event.title}</div>` };
      }
    });
    fullCalendarInstance.render();
  }
  
  const formatted = events.map(e => ({
    id: e.id,
    title: (e.isSystemGenerated ? '🛡️ Reserved' : e.title || 'Busy'),
    start: e.startTime,
    end: e.endTime,
    backgroundColor: e.isSystemGenerated ? 'var(--accent-success)' : 'var(--accent-primary)'
  }));
  
  fullCalendarInstance.removeAllEvents();
  fullCalendarInstance.addEventSource(formatted);
}

// ---- Modals & Command Palette ----
function openEventModal() {
  document.getElementById('eventModal').classList.add('active');
  const sel = document.getElementById('eventIdentity');
  sel.innerHTML = (currentUser?.identities || []).map(id => `<option value="${id.id}">${id.providerType}: ${id.providerEmail}</option>`).join('');
}
window.openEventModal = openEventModal;

function closeEventModal(e) {
  if (e === 'esc' || e.target.id === 'eventModal') {
    document.getElementById('eventModal').classList.remove('active');
  }
}
window.closeEventModal = closeEventModal;

async function handleCreateEvent(e) {
  e.preventDefault();
  const payload = {
    identityId: document.getElementById('eventIdentity').value,
    summary: document.getElementById('eventSummary').value,
    startTime: document.getElementById('eventStart').value,
    endTime: document.getElementById('eventEnd').value
  };
  await fetch('/api/calendar/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), credentials: 'include'
  });
  closeEventModal('esc');
  showToast('Event Created & Syncing...');
  fetchDashboardData();
}
window.handleCreateEvent = handleCreateEvent;

function openCommandPalette() {
  document.getElementById('commandPalette').classList.add('active');
  setTimeout(() => document.getElementById('paletteInput').focus(), 100);
}

function closeCommandPalette(e) {
  if (e === 'esc' || e.target.id === 'commandPalette') {
    document.getElementById('commandPalette').classList.remove('active');
    document.getElementById('paletteInput').value = '';
    document.getElementById('paletteResults').innerHTML = '';
  }
}
window.closeCommandPalette = closeCommandPalette;

function handleKeyboardShortcuts(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault(); openCommandPalette();
  }
  if (e.key === 'Escape') {
    closeCommandPalette('esc');
    closeEventModal('esc');
  }
}

function handlePaletteSearch(q) {
  clearTimeout(paletteSearchTimeout);
  if (!q) {
    document.getElementById('paletteResults').innerHTML = '';
    return;
  }
  paletteSearchTimeout = setTimeout(async () => {
    const res = await fetch(`/api/calendar/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
    const data = await res.json();
    const container = document.getElementById('paletteResults');
    if (!data.events?.length) {
      container.innerHTML = '<div style="padding:20px; color:var(--text-muted);">No events found.</div>';
      return;
    }
    container.innerHTML = data.events.map(ev => `
      <div class="palette-item" onclick="navigateToDate('${ev.startTime}')">
        <div class="palette-title">${escapeHtml(ev.summary || 'Meeting')}</div>
        <div class="palette-meta">${new Date(ev.startTime).toLocaleString()}</div>
      </div>
    `).join('');
  }, 300);
}
window.handlePaletteSearch = handlePaletteSearch;

function navigateToDate(dateStr) {
  if (fullCalendarInstance) {
    fullCalendarInstance.gotoDate(dateStr);
    fullCalendarInstance.changeView('timeGridDay');
  }
  closeCommandPalette('esc');
}
window.navigateToDate = navigateToDate;

// ---- Utilities ----
function showToast(msg, type='success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = type === 'success' ? `✅ ${msg}` : `⚠️ ${msg}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
