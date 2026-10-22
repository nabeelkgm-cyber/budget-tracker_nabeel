// Netlify (and some other hosts) silently skip any folder named "node_modules" when you upload a site,
// which loses the database engine and fonts. Rename that folder inside dist and update the references.
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const from = path.join(dist, 'assets', 'node_modules');
const to = path.join(dist, 'assets', 'vendor');
if (!fs.existsSync(from)) {
  console.log('Nothing to fix.');
  process.exit(0);
}
fs.renameSync(from, to);

let changed = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|html|css|json)$/.test(e.name)) {
      const s = fs.readFileSync(p, 'utf8');
      const t = s.split('assets/node_modules/').join('assets/vendor/');
      if (t !== s) {
        fs.writeFileSync(p, t);
        changed++;
      }
    }
  }
};
walk(dist);
console.log(`Renamed assets/node_modules to assets/vendor and updated ${changed} files.`);
