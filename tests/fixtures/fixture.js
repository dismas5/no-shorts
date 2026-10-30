// Test fixture only. Not included in either extension package.
document.getElementById('push').onclick = () => history.pushState({}, '', '/section/spa');
document.getElementById('replace').onclick = () => history.replaceState({}, '', '/section/replace');
document.getElementById('back').onclick = () => history.back();
document.getElementById('forward').onclick = () => history.forward();
window.addEventListener('pageshow', event => { document.getElementById('restored').textContent = `pageshow persisted=${event.persisted}`; });
