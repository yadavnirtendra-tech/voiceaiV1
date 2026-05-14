/**
 * OpenCalendar Super Admin Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  fetchAdminData();
  
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
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
  tbody.innerHTML = users.map(user => `
    <tr>
      <td>
        <div style="font-weight: 600;">${user.displayName || 'Unnamed'}</div>
        <div style="font-size: 0.7rem; color: var(--text-muted);">${user.email}</div>
      </td>
      <td>
        <span class="badge ${user.plan === 'PRO' ? 'badge-pro' : 'badge-free'}">${user.plan}</span>
      </td>
      <td>
        <span style="font-size: 0.75rem;">${user.subscriptionStatus}</span>
      </td>
      <td>${user._count.identities} accounts</td>
      <td style="font-size: 0.75rem;">${new Date(user.createdAt).toLocaleDateString()}</td>
      <td>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-ghost btn-sm action-btn" onclick="togglePlan('${user.id}', '${user.plan}')">
            ${user.plan === 'PRO' ? 'Downgrade' : 'Upgrade to Pro'}
          </button>
          <button class="btn btn-ghost btn-sm action-btn" onclick="resetPassword('${user.id}')">Reset Pass</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function togglePlan(userId, currentPlan) {
  const newPlan = currentPlan === 'PRO' ? 'FREE_TRIAL' : 'PRO';
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
  if (!confirm('Send password reset email to this user?')) return;
  try {
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
      credentials: 'include'
    });
    if (res.ok) alert('Reset email triggered!');
  } catch (err) {
    alert('Failed to trigger reset');
  }
}
