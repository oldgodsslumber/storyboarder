/* theme.js — light / dark. Runs before anything else so there is no flash.
 * The choice is a browser preference, not project data — it never touches the file.
 */
window.SB = window.SB || {};
(function (SB) {
  'use strict';

  const KEY = 'sb.theme';

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function systemPref() {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
      ? 'light' : 'dark';
  }

  function current() { return document.documentElement.getAttribute('data-theme') || 'dark'; }

  function apply(t) {
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
    const b = document.getElementById('btnTheme');
    if (b) {
      b.textContent = t === 'light' ? '☾' : '☀';
      b.title = t === 'light' ? 'Switch to dark' : 'Switch to light';
    }
  }

  function set(t) {
    try { localStorage.setItem(KEY, t); } catch (e) { }
    apply(t);
  }

  function toggle() { set(current() === 'light' ? 'dark' : 'light'); }

  apply(stored() || systemPref());
  document.addEventListener('DOMContentLoaded', function () { apply(current()); });

  SB.Theme = { apply: apply, set: set, toggle: toggle, current: current };

})(window.SB);
