// Netlify (and some other hosts) silently skip any folder named "node_modules" when you upload a site,
// which loses the database engine and fonts. Rename that folder inside dist and update the references.
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');

// Expo's single-page export ignores custom HTML, so add what the iPhone needs to install the site as an app,
// and keep pop-up sheets inside the same phone-width column as the rest of the app.
const indexPath = path.join(dist, 'index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');
  if (!html.includes('apple-mobile-web-app-capable')) {
    html = html.replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />');
    const extra = [
      '<meta name="apple-mobile-web-app-capable" content="yes" />',
      '<meta name="mobile-web-app-capable" content="yes" />',
      '<meta name="apple-mobile-web-app-title" content="Budget" />',
      '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
      '<link rel="manifest" href="/manifest.webmanifest" />',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
      '<style>body{background:#DDE1E8}@media (prefers-color-scheme:dark){body{background:#000}}' +
        'div[aria-modal="true"]{background-color:#DDE1E8!important}@media (prefers-color-scheme:dark){div[aria-modal="true"]{background-color:#000!important}}' +
        'div[aria-modal="true"] *:focus{outline:none}' +
        'div[aria-modal="true"]>div{max-width:560px;margin-left:auto;margin-right:auto;width:100%}</style>',
    ].join('\n    ');
    html = html.replace('</head>', `    ${extra}\n  </head>`);
    fs.writeFileSync(indexPath, html);
    console.log('Added iPhone install tags to index.html.');
  }
}

const from = path.join(dist, 'assets', 'node_modules');
const to = path.join(dist, 'assets', 'vendor');
if (!fs.existsSync(from)) {
  console.log('Nothing to fix.');
  process.exit(0);
}
fs.renameSync(from, to);

// Some hosts also skip folders whose name starts with "@" (such as @expo, which holds the icon fonts).
const renames = [];
for (const e of fs.readdirSync(to, { withFileTypes: true })) {
  if (e.isDirectory() && e.name.startsWith('@')) {
    const fresh = `at-${e.name.slice(1)}`;
    fs.renameSync(path.join(to, e.name), path.join(to, fresh));
    renames.push([`assets/vendor/${e.name}/`, `assets/vendor/${fresh}/`]);
  }
}

let changed = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|html|css|json)$/.test(e.name)) {
      const s = fs.readFileSync(p, 'utf8');
      let t = s.split('assets/node_modules/').join('assets/vendor/');
      for (const [a, b] of renames) t = t.split(a).join(b);
      if (t !== s) {
        fs.writeFileSync(p, t);
        changed++;
      }
    }
  }
};
walk(dist);
console.log(`Renamed assets/node_modules to assets/vendor and updated ${changed} files.`);

// A ready-to-upload zip of the site (for hosts where you upload a file, such as Hostinger's File Manager).
const { zipSync } = require('fflate');
const files = {};
const collect = (dir, prefix) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, `${prefix}${e.name}/`);
    else files[`${prefix}${e.name}`] = new Uint8Array(fs.readFileSync(p));
  }
};
collect(dist, '');
fs.writeFileSync(path.join(__dirname, '..', 'budget-app.zip'), zipSync(files));
console.log('Created budget-app.zip (upload this to Hostinger).');
