const path = require('path');

function getUploadsRoot() {
  const configured = process.env.UPLOADS_DIR && String(process.env.UPLOADS_DIR).trim();
  return path.resolve(configured || path.join(process.cwd(), 'uploads'));
}

function uploadsPath(...parts) {
  return path.join(getUploadsRoot(), ...parts);
}

module.exports = {
  getUploadsRoot,
  uploadsPath,
};
