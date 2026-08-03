/* test-typing.mjs — drives the built app with REAL input events over the
 * DevTools protocol (mouse clicks, key presses, selection), because synthetic
 * beforeinput events in test-ui.mjs can't catch focus/selection bugs.
 * usage: node test-typing.mjs
 */
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => { try { readFileSync(p); return true; } catch { return false; } });
if (!CHROME) { console.error('No Chrome/Edge found'); process.exit(2); }

const page = join(root, '_typing_' + Date.now() + '.html');
writeFileSync(page, readFileSync(join(root, 'storyboarder.html'), 'utf8'), 'utf8');
const profile = mkdtempSync(join(tmpdir(), 'sb-'));
const PORT = 9333;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1500,900',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  'file:///' + page.replace(/\\/g, '/')
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json');
      const list = await r.json();
      const p = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { }
    await sleep(250);
  }
  throw new Error('devtools never came up');
}

let ws, id = 0;
const waiting = new Map();
function send(method, params) {
  const msg = { id: ++id, method, params: params || {} };
  return new Promise((res, rej) => {
    waiting.set(msg.id, { res, rej });
    ws.send(JSON.stringify(msg));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', {
    expression: '(function(){' + expr + '})()',
    returnByValue: true, awaitPromise: true
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
  return r.result.value;
}

/* real key press: keyDown + char + keyUp, like a human */
/* The character comes from `text`; the virtual key code must NOT be derived
 * from it — '!' is 33, which is VK_PRIOR (PageUp), so Chrome would scroll
 * instead of typing. A fixed letter key with the right `text` is what a real
 * keypress looks like to the page. */
async function typeText(text) {
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown', text: ch, unmodifiedText: ch,
      key: ch, code: 'KeyA', windowsVirtualKeyCode: 65
    });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'KeyA', windowsVirtualKeyCode: 65 });
    await sleep(10);
  }
}
/* Enter/Tab need a char event (text:'\r'), deletion keys must not have one —
 * a rawKeyDown Enter produces no beforeinput at all. */
async function pressKey(key, vk, code, mods) {
  const base = { key, code, windowsVirtualKeyCode: vk, modifiers: mods || 0 };
  const down = key === 'Enter'
    ? Object.assign({ type: 'keyDown', text: '\r', unmodifiedText: '\r' }, base)
    : Object.assign({ type: 'rawKeyDown' }, base);
  await send('Input.dispatchKeyEvent', down);
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
}
async function clickAt(x, y, count) {
  const common = { x, y, button: 'left', clickCount: count || 1, buttons: 1 };
  await send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, common));
  await send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, common));
}
async function dragSelect(x1, y1, x2, y2) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (x1 + x2) / 2, y: (y1 + y2) / 2, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x2, y: y2, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1, buttons: 1 });
}
async function boxOf(selector) {
  return evaluate('var e=document.querySelector(' + JSON.stringify(selector) + ');' +
    'if(!e) return null; var r=e.getBoundingClientRect();' +
    'return {x:r.left,y:r.top,w:r.width,h:r.height};');
}

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  :: ' + JSON.stringify(extra))); }
}

const target = await targets();
ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) {
    const w = waiting.get(m.id);
    waiting.delete(m.id);
    m.error ? w.rej(new Error(m.error.message)) : w.res(m.result);
  }
});
await send('Runtime.enable');
await send('Page.enable');
await sleep(700);

const errors = [];
await evaluate('window.__err=[];window.addEventListener("error",function(e){window.__err.push(e.message)});return 1;');

try {
  /* ---------------- open the script panel and type into an EMPTY master ---------------- */
  await evaluate('SB.ScriptMode.open(); return 1;');
  await sleep(150);
  let box = await boxOf('#masterScript');
  t('script panel is on screen', !!box && box.w > 100, box);

  await clickAt(box.x + 40, box.y + 20);
  await sleep(80);
  t('clicking the master focuses it',
    await evaluate('return document.activeElement && document.activeElement.id;') === 'masterScript',
    await evaluate('return document.activeElement && document.activeElement.id;'));

  await typeText('Hello');
  await sleep(150);
  t('typing into an empty master script works',
    await evaluate('return SB.app.project.master.text;') === 'Hello',
    await evaluate('return SB.app.project.master.text;'));
  t('what is typed is what is shown',
    await evaluate('return document.getElementById("masterScript").textContent;') === 'Hello',
    await evaluate('return document.getElementById("masterScript").textContent;'));

  await typeText(' world');
  await sleep(150);
  t('the caret stays put between keystrokes',
    await evaluate('return SB.app.project.master.text;') === 'Hello world',
    await evaluate('return SB.app.project.master.text;'));

  /* ---------------- select with the mouse, then Capture ---------------- */
  await evaluate(
    'var el=document.getElementById("masterScript");' +
    'SB.Model.applyMasterEdit(SB.app.project,0,SB.app.project.master.text.length,' +
    '"Wide of the office. Then a close-up of the laptop.",null);' +
    'SB.app.scriptChanged(); return 1;');
  await sleep(150);

  await clickAt(box.x + 40, box.y + 20);
  await sleep(50);
  await evaluate('var el=document.getElementById("masterScript"); el.focus(); SB.Editor.setSel(el,0,19); ' +
    'document.dispatchEvent(new Event("selectionchange")); return 1;');
  await sleep(120);
  t('Capture enables when text is selected',
    await evaluate('return !document.getElementById("btnCapture").disabled;'),
    await evaluate('return document.getElementById("btnCapture").disabled;'));

  const cap = await boxOf('#btnCapture');
  await clickAt(cap.x + cap.w / 2, cap.y + cap.h / 2);
  await sleep(200);
  t('clicking Capture opens the form (selection survives the click)',
    await evaluate('return !document.getElementById("captureForm").classList.contains("hidden");'),
    await evaluate('return document.getElementById("captureForm").innerHTML.length;'));
  t('the form previews the selected text',
    await evaluate('var p=document.querySelector("#captureForm .preview"); return p?p.textContent:"";')
    === 'Wide of the office.',
    await evaluate('var p=document.querySelector("#captureForm .preview"); return p?p.textContent:"(none)";'));

  const done = await boxOf('#captureForm .mini.primary');
  if (done) {
    await clickAt(done.x + done.w / 2, done.y + done.h / 2);
    await sleep(250);
  }
  t('Complete makes a shot from the selection',
    await evaluate('var n=0;SB.Model.eachShot(SB.app.project,function(s){if(s.link)n++});return n;') === 1,
    await evaluate('var n=0;SB.Model.eachShot(SB.app.project,function(s){if(s.link)n++});return n;'));

  /* ---------------- type into the LINKED shot box ---------------- */
  const linkedSel = await evaluate(
    'var id=null;SB.Model.eachShot(SB.app.project,function(s){if(s.link&&!id)id=s.id});' +
    'return ".script-box[data-shot=\\"" + id + "\\"]";');
  const sbox = await boxOf(linkedSel);
  t('the captured card has a script box', !!sbox, sbox);
  if (sbox) {
    await clickAt(sbox.x + 20, sbox.y + 10);
    await sleep(100);
    t('clicking a shot script box focuses it',
      await evaluate('var a=document.activeElement;return a?a.className:"none";') === 'script-box',
      await evaluate('var a=document.activeElement;return a?a.className:"none";'));
    await typeText('!');
    await sleep(250);
    t('typing in a shot box writes through to the master',
      /!/.test(await evaluate('return SB.app.project.master.text;')),
      await evaluate('return SB.app.project.master.text.slice(0,40);'));
    t('the shot window shows it too',
      /!/.test(await evaluate('var e=document.querySelector(' + JSON.stringify(linkedSel) + ');return e.textContent;')),
      await evaluate('var e=document.querySelector(' + JSON.stringify(linkedSel) + ');return e.textContent;'));
  }

  /* ---------------- the demo bug: selection must survive losing focus ------- */
  await evaluate('var el=document.getElementById("masterScript");el.focus();SB.Editor.setSel(el,0,18);return 1;');
  await sleep(150);
  t('Capture lights up for a fresh selection',
    await evaluate('return !document.getElementById("btnCapture").disabled;'), '');
  const desc = await boxOf('.card .desc-box');
  await clickAt(desc.x + 40, desc.y + 12);            // user clicks a card, as in a review
  await sleep(200);
  t('the live DOM selection is gone after clicking away',
    await evaluate('var s=SB.Editor.getSel(document.getElementById("masterScript"));return s===null;'), '');
  const cap2 = await boxOf('#btnCapture');
  await clickAt(cap2.x + cap2.w / 2, cap2.y + cap2.h / 2);
  await sleep(250);
  t('Capture still works — the selection is latched, not lost',
    await evaluate('return !document.getElementById("captureForm").classList.contains("hidden");'), '');
  await evaluate('var b=document.querySelector("#captureForm .mini:not(.primary)");if(b)b.click();return 1;');
  await sleep(150);
  t('cancelling clears the latch, so Capture goes dark again',
    await evaluate('return document.getElementById("btnCapture").disabled;'), '');

  /* ---------------- undo / redo ---------------- */
  await evaluate('SB.History.reset();return 1;');
  const preUndo = await evaluate('return SB.app.project.master.text;');
  box = await boxOf('#masterScript');
  await clickAt(box.x + 40, box.y + 15);
  await sleep(80);
  await evaluate('var el=document.getElementById("masterScript");el.focus();SB.Editor.setSel(el,10,10);return 1;');
  await typeText('UNDOME');
  await sleep(250);
  const typed = await evaluate('return SB.app.project.master.text;');
  t('typing changed the script', typed !== preUndo, '');
  t('a run of keystrokes is one undo step',
    await evaluate('return SB.History.depth();') === 1,
    await evaluate('return SB.History.depth();'));
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await sleep(250);
  t('Ctrl+Z undoes the edit',
    await evaluate('return SB.app.project.master.text;') === preUndo,
    await evaluate('return SB.app.project.master.text.slice(0,40);'));
  t('the view matches the model after undo',
    await evaluate('return document.getElementById("masterScript").textContent === SB.app.project.master.text;'), '');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 10 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 10 });
  await sleep(250);
  t('Ctrl+Shift+Z redoes it',
    await evaluate('return SB.app.project.master.text;') === typed,
    await evaluate('return SB.app.project.master.text.slice(0,40);'));

  /* ---------------- caret at the edge of a highlight span ---------------- */
  const span = await evaluate(
    'var s=document.querySelector("#masterScript .h1");if(!s)return null;' +
    'var r=s.getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height,len:s.textContent.length};');
  t('captured text is highlighted in the master', !!span, span);
  if (span) {
    await clickAt(span.x + span.w - 1, span.y + span.h / 2);
    await sleep(120);
    const caret = await evaluate('return SB.Editor.getSel(document.getElementById("masterScript")).start;');
    t('clicking the edge of a highlight reports the right offset', caret === span.len,
      caret + ' vs ' + span.len);
    await typeText('#');
    await sleep(220);
    t('and the character lands where it was typed',
      await evaluate('return SB.app.project.master.text.indexOf("#");') === span.len,
      await evaluate('return SB.app.project.master.text.indexOf("#");'));
  }

  /* ---------------- keep typing in the master afterwards ---------------- */
  box = await boxOf('#masterScript');
  await clickAt(box.x + 40, box.y + 20);
  await sleep(60);
  await evaluate('var el=document.getElementById("masterScript");el.focus();' +
    'SB.Editor.setSel(el, el.textContent.length, el.textContent.length);return 1;');
  await typeText('X');
  await sleep(200);
  t('the master still accepts typing after a capture',
    /X$/.test(await evaluate('return SB.app.project.master.text;')),
    await evaluate('return SB.app.project.master.text.slice(-10);'));

  /* ---------------- Enter / Backspace ---------------- */
  await pressKey('Enter', 13, 'Enter');
  await sleep(150);
  await typeText('two');
  await sleep(200);
  t('Enter inserts a newline',
    /\ntwo$/.test(await evaluate('return SB.app.project.master.text;')),
    JSON.stringify(await evaluate('return SB.app.project.master.text.slice(-8);')));
  await pressKey('Backspace', 8, 'Backspace');
  await sleep(150);
  t('Backspace deletes one character',
    /\ntw$/.test(await evaluate('return SB.app.project.master.text;')),
    JSON.stringify(await evaluate('return SB.app.project.master.text.slice(-8);')));

  errors.push(...(await evaluate('return window.__err;')));
  t('no page errors', errors.length === 0, errors);
} catch (e) {
  fail++;
  console.log('  FAIL exception :: ' + (e && e.stack || e));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
try { ws.close(); } catch { }
chrome.kill();
await sleep(300);
try { rmSync(page); } catch { }
try { rmSync(profile, { recursive: true, force: true }); } catch { }
process.exit(fail ? 1 : 0);
