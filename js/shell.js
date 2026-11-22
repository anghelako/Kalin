/* Shared shell additions. The bootstrap owns the controls and circle rail. */
(function () {
  if (!document.body.classList.contains('app-v2')) return;

  const circleTab = document.querySelector('[data-circle-tab]');
  const circleList = document.getElementById('circle-list-items');
  const profileName = document.querySelector('[data-profile-name]');
  const pharmacyCircle = document.getElementById('pharm-root') && activeCircleId;

  function syncCircleNavigation() {
    let lastCircle = null;
    try {
      lastCircle = localStorage.getItem('kalin.lastCircle');
    } catch (_) {
      // Storage can be disabled by the browser.
    }

    // The shared renderer emits one link per circle, in membership order.
    circleList?.querySelectorAll('.circle-link').forEach((link, index) => {
      const selected = circles[index]?.id === (pharmacyCircle || lastCircle);
      link.classList.toggle('active', selected);
      if (selected) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  window.addEventListener('kalin:circles', syncCircleNavigation);
  window.addEventListener('pageshow', syncCircleNavigation);
  window.addEventListener('storage', event => {
    if (event.key === 'kalin.lastCircle' || event.key === null) syncCircleNavigation();
  });
  window.kalinReady.then(user => {
    if (user) profileName.title = profileName.textContent;
  });
  circleTab.href = 'circles.html';
  syncCircleNavigation();
})();

