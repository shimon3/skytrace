const form = document.getElementById('login-form');
const tokenInput = document.getElementById('admin-token');
const dashboard = document.getElementById('dashboard');
const errorBox = document.getElementById('error');
const refreshButton = document.getElementById('refresh');

let token = '';

function setText(id, value) {
  document.getElementById(id).textContent = String(value ?? '—');
}

async function loadStats() {
  errorBox.textContent = '';
  dashboard.style.display = 'none';

  try {
    const response = await fetch('/api/admin-stats', {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error('Jeton administrateur incorrect.');
      if (payload.error === 'ADMIN_NOT_CONFIGURED') {
        throw new Error('ADMIN_STATS_TOKEN n’est pas encore configuré dans Cloudflare Pages.');
      }
      throw new Error(`Erreur ${response.status}`);
    }

    setText('requests', payload.requests);
    setText('remaining', payload.remaining);
    setText('successes', payload.successes);
    setText('failures', payload.failures);
    setText('cache-hits', payload.cacheHits);
    setText('quota-blocked', payload.quotaBlocked);

    const progress = document.getElementById('quota-progress');
    progress.max = payload.dailyLimit || 500;
    progress.value = payload.requests || 0;

    document.getElementById('quota-text').textContent =
      `${payload.requests} / ${payload.dailyLimit} requêtes utilisées (${payload.percentUsed} %).`;
    document.getElementById('details').textContent =
      `Jour UTC : ${payload.day} · Dernière requête : ${payload.lastRequestAt || 'aucune'} · ` +
      `Dernier statut : ${payload.lastStatus ?? '—'} · Stockage : ${payload.storage}`;

    dashboard.style.display = 'block';
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  token = tokenInput.value;
  loadStats();
});

refreshButton.addEventListener('click', loadStats);
