/**
 * OpenCalendar Super Admin Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  fetchAdminData();
  
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Live Clock
  setInterval(() => {
    const now = new Date();
    document.getElementById('liveClock').textContent = now.toLocaleTimeString();
  }, 1000);
});

async function fetchAdminData() {
  try {
    const [statsRes, usersRes] = await Promise.all([
      fetch('/api/admin/stats', { credentials: 'include' }),
      fetch('/api/admin/users', { credentials: 'include' })
    ]);

    const statsData = await statsRes.json();
    const usersData = await usersRes.json();

    if (statsData.success) {
      document.getElementById('statTotalUsers').textContent = statsData.stats.totalUsers;
      document.getElementById('statTotalIdentities').textContent = statsData.stats.totalIdentities;
      document.getElementById('statSyncs').textContent = statsData.stats.syncsLast24h;
    }

    if (usersData.success) {
      renderUsers(usersData.users);
    }
  } catch (err) {
    console.error('Admin fetch failed', err);
  }
}

function renderUsers(users) {
  const tbody = document.getElementById('userTableBody');
  tbody.innerHTML = users.map(user => {
    const isPro = user.plan === 'PRO';
    const isAdmin = user.isAdmin;
    
    return `
    <tr>
      <td>
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 32px; height: 32px; background: rgba(255,255,255,0.05); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #fff;">
            ${(user.displayName || user.email)[0].toUpperCase()}
          </div>
          <div>
            <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px;">
              ${user.displayName || 'Unnamed'}
              ${isAdmin ? '<span class="badge badge-admin">SUPER ADMIN</span>' : ''}
            </div>
            <div style="font-size: 0.75rem; color: #64748b;">${user.email}</div>
          </div>
        </div>
      </td>
      <td>
        <span class="badge ${isPro ? 'badge-pro' : 'badge-free'}">${user.plan.replace('_', ' ')}</span>
      </td>
      <td>
        <span style="font-size: 0.75rem; font-weight: 600; color: #94a3b8;">${user.subscriptionStatus}</span>
      </td>
      <td style="font-weight: 600;">${user._count.identities} <span style="font-size:0.7rem; color:#64748b;">accounts</span></td>
      <td style="font-size: 0.75rem; color: #94a3b8;">${new Date(user.createdAt).toLocaleDateString()}</td>
      <td>
        <div style="display: flex; gap: 8px;">
          <button class="btn-action" onclick="togglePlan('${user.id}', '${user.plan}')">
            ${isPro ? '⚡ Make Free' : '💎 Upgrade to Pro'}
          </button>
          <button class="btn-action btn-danger-soft" onclick="resetPassword('${user.id}')">🔐 Reset</button>
        </div>
      </td>
    </tr>
  `}).join('');
}

async function togglePlan(userId, currentPlan) {
  const newPlan = currentPlan === 'PRO' ? 'FREE' : 'PRO';
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: newPlan }),
      credentials: 'include'
    });
    if (res.ok) fetchAdminData();
  } catch (err) {
    alert('Plan update failed');
  }
}

async function resetPassword(userId) {
  if (!confirm('Force reset this user\'s password to a temporary one?')) return;
  try {
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
      credentials: 'include'
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
    } else {
      alert('Failed: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Failed to trigger reset');
  }
}

function toggleStripe() {
  const isEnabled = document.getElementById("stripeToggle").checked;
  alert("Stripe Payments " + (isEnabled ? "Enabled" : "Disabled") + ". Admin overrides are now " + (isEnabled ? "restricted" : "active") + ".");
}
