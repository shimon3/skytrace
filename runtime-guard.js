(() => {
  const nativeFetch = window.fetch.bind(window);
  let aircraftQueue = Promise.resolve();
  let lastSuccessfulUpdate = null;

  function isAircraftRequest(input) {
    const url = typeof input === 'string' ? input : input?.url || '';
    return url.startsWith('https://api.airplanes.live/');
  }

  function updateAgeLabel() {
    const status = document.getElementById('status');
    if (!status || !lastSuccessfulUpdate || !status.classList.contains('live')) return;

    const seconds = Math.max(0, Math.floor((Date.now() - lastSuccessfulUpdate) / 1000));
    status.title = `Dernière donnée reçue il y a ${seconds} seconde${seconds > 1 ? 's' : ''}`;
    status.setAttribute('aria-label', status.title);
  }

  window.fetch = function guardedFetch(input, init) {
    if (!isAircraftRequest(input)) return nativeFetch(input, init);

    const run = async () => {
      const response = await nativeFetch(input, init);
      if (response.ok) lastSuccessfulUpdate = Date.now();
      return response;
    };

    const queued = aircraftQueue.then(run, run);
    aircraftQueue = queued.catch(() => undefined);
    return queued;
  };

  window.setInterval(updateAgeLabel, 1000);
})();
