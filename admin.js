const form = document.getElementById('login-form');
const tokenInput = document.getElementById('admin-token');
const dashboard = document.getElementById('dashboard');
const errorBox = document.getElementById('error');
const refreshButton = document.getElementById('refresh');
const logoutButton = document.getElementById('logout');
const providersBox = document.getElementById('providers');
const hourlyChart = document.getElementById('hourly-chart');
const dailyChart = document.getElementById('daily-chart');

let token = sessionStorage.getItem('skytrace-admin-token') || '';
let autoRefreshTimer = null;

function setText(id, value) {
  document.getElementById(id).textContent = String(value ?? '—');
}

function formatDate(value) {
  if (!value) return 'Jamais';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('fr-FR');
}

function healthLabel(value) {
  return {
    operational: 'Opérationnel',
    limited: 'Limité',
    degraded: 'Dégradé',
    unavailable: 'Indisponible',
    'not-configured': 'Non configuré',
    unknown: 'Pas encore testé',
  }[value] || value;
}

function renderProviders(providers = []) {
  providersBox.replaceChildren();
  for (const provider of providers) {
    const card = document.createElement('article');
    card.className = 'provider';
    card.innerHTML = `
      <div class="provider-head">
        <strong>${provider.label}</strong>
        <span class="status ${provider.health}">${healthLabel(provider.health)}</span>
      </div>
      <dl>
        <dt>Requêtes aujourd’hui</dt><dd>${provider.requests}</dd>
        <dt>Succès</dt><dd>${provider.successes}</dd>
        <dt>Échecs</dt><dd>${provider.failures}</dd>
        <dt>Dernier HTTP</dt><dd>${provider.lastStatus ?? '—'}</dd>
        <dt>Dernier appel</dt><dd>${formatDate(provider.lastRequestAt)}</dd>
      </dl>`;
    providersBox.appendChild(card);
  }
}

function renderBars(container, data, labelKey) {
  container.replaceChildren();
  const max = Math.max(1, ...data.map((item) => Number(item.requests) || 0));
  for (const item of data) {
    const wrap = document.createElement('div');
    wrap.className = 'bar-wrap';
    const value = Number(item.requests) || 0;
    const height = Math.max(value ? 5 : 2, Math.round((value / max) * 130));
    wrap.innerHTML = `<span class="bar-value">${value}</span><div class="bar" style="height:${height}px" title="${value} requêtes"></div><span class="bar-label">${item[labelKey]}</span>`;
    container.appendChild(wrap);
  }
}

async function loadStats() {
  if (!token) return;
  errorBox.textContent = '';

  try {
    const response = await fetch('/api/admin-stats', {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error('Jeton administrateur incorrect.');
      if (payload.error === 'ADMIN_NOT_CONFIGURED') throw new Error('Le jeton administrateur doit être configuré dans Cloudflare Pages.');
      throw new Error(`Erreur ${response.status}`);
    }

    sessionStorage.setItem('skytrace-admin-token', token);
    form.style.display = 'none';
    dashboard.style.display = 'block';

    setText('requests', payload.requests);
    setText('remaining', payload.remaining);
    setText('successes', payload.successes);
    setText('failures', payload.failures);
    setText('cache-hits', payload.cacheHits);
    setText('quota-blocked', payload.quotaBlocked);

    const progress = document.getElementById('quota-progress');
    progress.max = payload.dailyLimit || 500;
    progress.value = payload.airplanesLiveRequests || 0;

    document.getElementById('quota-text').textContent = `${payload.percentUsed || 0} % du quota journalier principal consommé.`;
    document.getElementById('details').textContent = `Jour UTC : ${payload.day} · Bascules de secours : ${payload.fallbackActivations || 0} · Dernier service : ${payload.lastProvider || '—'} · Dernier statut : ${payload.lastStatus ?? '—'} · Stockage : ${payload.storage}`;
    document.getElementById('updated-at').textContent = `Actualisé : ${new Date().toLocaleTimeString('fr-FR')}`;

    renderProviders(payload.providers || []);
    renderBars(hourlyChart, payload.hourly || [], 'hour');
    renderBars(dailyChart, payload.history || [], 'day');
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error);
    if (String(errorBox.textContent).includes('incorrect')) {
      sessionStorage.removeItem('skytrace-admin-token');
      dashboard.style.display = 'none';
      form.style.display = 'flex';
    }
  }
}

function startAutoRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(loadStats, 60000);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  token = tokenInput.value;
  loadStats();
  startAutoRefresh();
});

refreshButton.addEventListener('click', loadStats);
logoutButton.addEventListener('click', () => {
  token = '';
  sessionStorage.removeItem('skytrace-admin-token');
  dashboard.style.display = 'none';
  form.style.display = 'flex';
  tokenInput.value = '';
  clearInterval(autoRefreshTimer);
});

if (token) {
  tokenInput.value = token;
  loadStats();
  startAutoRefresh();
}
