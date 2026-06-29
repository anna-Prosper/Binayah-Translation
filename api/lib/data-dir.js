'use strict';
const path = require('path');
// On Render set DATA_DIR to the persistent disk mount path (e.g. /data).
// Falls back to the api/ root directory for local development.
const ROOT = process.env.DATA_DIR || path.join(__dirname, '..');
module.exports = (...parts) => path.join(ROOT, ...parts);
