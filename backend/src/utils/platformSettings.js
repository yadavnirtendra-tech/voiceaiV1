import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = path.join(__dirname, '../../data/platformSettings.json');

// Ensure data dir exists
try {
  fs.mkdirSync(path.join(__dirname, '../../data'), { recursive: true });
} catch (e) {}

// Default settings
const defaultSettings = {
  systemLockdown: false,
};

export function getPlatformSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      return { ...defaultSettings };
    }
    const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...defaultSettings, ...JSON.parse(data) };
  } catch (e) {
    console.error('Failed to read platform settings:', e);
    return { ...defaultSettings };
  }
}

export function updatePlatformSettings(updates) {
  try {
    const current = getPlatformSettings();
    const next = { ...current, ...updates };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
    return next;
  } catch (e) {
    console.error('Failed to write platform settings:', e);
    return null;
  }
}
