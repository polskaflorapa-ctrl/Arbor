const fs = require('node:fs');
const path = require('node:path');

const files = [
  ['Render arbor-os env', 'deploy/render-arbor-os.env.example'],
  ['Railway arbor-os demo env', 'deploy/railway-arbor-os.env.example'],
  ['Cloudflare Pages web demo env', 'deploy/cloudflare-pages.env.example'],
  ['Local production doctor env', 'deploy/local-production-doctor.env.example'],
  ['Mobile Expo env', 'deploy/mobile-production.env.example'],
  ['Web env', 'deploy/web-production.env.example'],
  ['Vercel env', 'deploy/vercel.env.example'],
];

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8').trimEnd();
}

function main() {
  for (const [title, file] of files) {
    console.log(`\n# ==================== ${title} ====================`);
    console.log(`# Source: ${file}\n`);
    console.log(read(file));
  }
  console.log('\n# After filling Neon/R2 values:');
  console.log('# npm run deploy:prod:doctor');
  console.log('# npm run deploy:free:check -- https://<arbor-os>.onrender.com');
}

main();
