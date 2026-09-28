import { readConfig } from '../config.js';

try {
  const config = readConfig();
  console.log(`${config.origin}/#${config.secret}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
