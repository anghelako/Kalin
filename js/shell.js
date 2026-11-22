/* Home shell additions. The shared bootstrap owns the controls and circle rail. */
(function () {
  if (!document.body.classList.contains('app-v2')) return;

  const circleTab = document.querySelector('[data-circle-tab]');
  const circleList = document.getElementById('circle-list-items');
  const profileName = document.querySelector('[data-profile-name]');

  function syncCircleNavigation() {
    let lastCircle = null;
    try {
      lastCircle = localStorage.getItem('kalin.lastCircle');
    } catch (_) {
      // Storage can be disabled by the browser.
    }

    circleTab.href = lastCircle ? 'circle.html?id=' + encodeURIComponent(lastCircle) : 'dashboard.html';
    // The shared renderer emits one button per circle, in membership order.
    circleList?.querySelectorAll('.circle-link').forEach((button, index) => {
      const selected = circles[index]?.id === lastCircle;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
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
  syncCircleNavigation();
})();

