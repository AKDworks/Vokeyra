#!/usr/bin/env node
// Read-only native Wayland environment check. It never changes compositor
// settings, group membership or installed packages.
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const exec = promisify(execFile);
const has = async path => access(path, constants.X_OK).then(() => true).catch(() => false);
const run = (file, args) => exec(file, args, { timeout: 5000 }).then(result => result.stdout.trim()).catch(() => '');

if (process.platform !== 'linux') {
  console.error('This check is for Linux.');
  process.exit(2);
}
const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
if (!wayland) {
  console.error('Start this check inside a native Wayland session (without GDK_BACKEND=x11).');
  process.exit(2);
}

const desktop = `${process.env.XDG_CURRENT_DESKTOP ?? ''}:${process.env.XDG_SESSION_DESKTOP ?? ''}`.toLowerCase();
const compositor = process.env.NIRI_SOCKET || desktop.includes('niri') ? 'niri'
  : process.env.HYPRLAND_INSTANCE_SIGNATURE || desktop.includes('hyprland') ? 'hyprland'
    : process.env.SWAYSOCK || desktop.includes('sway') ? 'sway'
      : process.env.KDE_FULL_SESSION || desktop.includes('kde') || desktop.includes('plasma') ? 'kde'
        : process.env.GNOME_DESKTOP_SESSION_ID || desktop.includes('gnome') ? 'gnome'
          : 'unknown';

async function tool(name) {
  for (const directory of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    const path = join(directory, name);
    if (await has(path)) return path;
  }
  return '';
}

const [wtype, ydotool, dotool, wlCopy, swhkd, busctl, gdbus] = await Promise.all(
  ['wtype', 'ydotool', 'dotool', 'wl-copy', 'swhkd', 'busctl', 'gdbus'].map(tool));
const layerShell = (await run('ldconfig', ['-p'])).includes('libgtk-layer-shell.so')
  || await exec('pkg-config', ['--exists', 'gtk-layer-shell-0']).then(() => true).catch(() => false);
const portalIntrospection = busctl
  ? await run(busctl, ['--user', '--no-pager', 'introspect', 'org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop'])
  : gdbus
    ? await run(gdbus, ['introspect', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop'])
    : '';
const portal = portalIntrospection.includes('org.freedesktop.portal.GlobalShortcuts');
const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? ''}`;
const socket = process.env.YDOTOOL_SOCKET || join(runtime, '.ydotool_socket');
const ydotoolSocket = await access(socket).then(() => true).catch(() => false);
const ydotoolDaemon = (await run('pgrep', ['-x', 'ydotoold'])) !== '';
const uinput = await access('/dev/uinput', constants.R_OK | constants.W_OK).then(() => true).catch(() => false);
const input = await access('/dev/input', constants.R_OK).then(() => true).catch(() => false);

console.log(`Session:        Wayland (${process.env.WAYLAND_DISPLAY})`);
console.log(`Compositor:     ${compositor}`);
console.log(`layer-shell:    ${layerShell ? 'library found (runtime protocol check is done by Vokeyra)' : 'not found'}`);
console.log(`GlobalShortcuts portal: ${portal ? 'interface exposed (not used by Vokeyra yet)' : 'not exposed'}`);
console.log(`wtype:          ${wtype ? 'found (not exercised; the check never sends keys)' : 'not found'}`);
console.log(`ydotool:        ${ydotool ? `found; daemon=${ydotoolDaemon ? 'running' : 'not running'}, socket=${ydotoolSocket ? 'present' : 'missing'}` : 'not found'}`);
console.log(`dotool:         ${dotool ? `found; /dev/uinput=${uinput ? 'writable' : 'not writable'}, /dev/input=${input ? 'readable' : 'not readable'}` : 'not found'}`);
console.log(`wl-clipboard:   ${wlCopy ? 'found' : 'not found'}`);
console.log(`swhkd:          ${swhkd ? 'found (configure "include <data>/swhkdrc" yourself)' : 'not found'}`);

if (compositor === 'niri') {
  const layers = await run('niri', ['msg', '--json', 'layers']);
  if (layers) {
    try {
      const list = JSON.parse(layers);
      const overlay = list.filter(layer => layer.namespace === 'vokeyra-indicator');
      if (overlay.length) {
        for (const layer of overlay) {
          console.log(`Layer surface: namespace=${layer.namespace} output=${layer.output} layer=${layer.layer} keyboard=${layer.keyboard_interactivity}`);
        }
      } else {
        console.log('Layer surface: not open (start a recording to inspect it)');
      }
    } catch { console.log('Layer surface: niri returned unreadable JSON'); }
  }
  const windows = await run('niri', ['msg', '--json', 'windows']);
  if (windows) {
    try {
      const list = JSON.parse(windows);
      const overlay = list.filter(window => window.title === 'Vokeyra Indicator');
      if (overlay.length) {
        for (const window of overlay) {
          console.log(`Fallback window: id=${window.id} app_id=${window.app_id} floating=${window.is_floating}`);
        }
      } else {
        console.log('Fallback window: none (expected while layer-shell is active)');
      }
    } catch { console.log('Fallback window: niri returned unreadable JSON'); }
  }
  console.log('\nniri binding (toggle only; niri has no key-release bindings):');
  console.log('binds {\n    Mod+Shift+Space { spawn "vokeyra" "--toggle"; }\n}');
}

console.log(`
Manual acceptance test:
1. Start a recording. The pill must stay 248x58 logical pixels, must not become a tile,
   and must not move focus out of the text field.
2. Type into a text field while recording; the keystrokes must reach the application.
3. Finish recording. Text must be inserted exactly once, or remain available in History.
4. Press the cancel button on the pill. The pill must disappear and no text must be inserted.
5. Repeat at 100%, 125%, 150% and 200% scale. Text and the level meter must stay sharp.
6. Unplug the external monitor while recording; the pill must remain on a visible output.
`);
