/* Shared shell additions. The bootstrap owns the controls and circle rail. */
(function () {
  if (!document.body.classList.contains('app-v2')) return;

  const circleTab = document.querySelector('[data-circle-tab]');
  const circleList = document.getElementById('circle-list-items');
  const profileName = document.querySelector('[data-profile-name]');
  const detailCircleId = document.getElementById('pharm-root') ? activeCircleId : null;

  function syncCircleNavigation() {
    // Only a detail page has a current circle. List pages must not inherit
    // the last circle opened in another page.
    circleList?.querySelectorAll('.circle-link').forEach(link => {
      const linkCircleId = new URL(link.href, window.location.href).searchParams.get('id');
      const selected = Boolean(detailCircleId && linkCircleId === detailCircleId);
      link.classList.toggle('active', selected);
      if (selected) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  window.addEventListener('kalin:circles', syncCircleNavigation);
  window.addEventListener('pageshow', syncCircleNavigation);
  window.kalinReady.then(user => {
    if (user) profileName.title = profileName.textContent;
  });
  circleTab.href = 'circles.html';
  syncCircleNavigation();
})();

