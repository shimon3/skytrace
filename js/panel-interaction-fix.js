const panel = document.getElementById('panel');
const routeButton = document.getElementById('btn-route');

if (panel && window.L?.DomEvent) {
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);
}

if (panel) {
  panel.addEventListener('pointerdown', (event) => event.stopPropagation());
  panel.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true });
  panel.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
}

if (routeButton) {
  routeButton.type = 'button';
  routeButton.setAttribute('aria-pressed', routeButton.classList.contains('active') ? 'true' : 'false');
  routeButton.addEventListener('click', () => {
    requestAnimationFrame(() => {
      routeButton.setAttribute(
        'aria-pressed',
        routeButton.classList.contains('active') ? 'true' : 'false'
      );
    });
  });
}
