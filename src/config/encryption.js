/**
 * AES-256-GCM Encryption Module for Token Storage
 * 
 * Every OAuth token is encrypted at rest using AES-256-GCM with a unique
 * initialization vector (IV) per encryption operation. This ensures that
 * even identical tokens produce different ciphertext.
 */
import crypto from 'crypto';
import config from './env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;      // 128-bit IV
const TAG_LENGTH = 16;     // 128-bit auth tag
const KEY = Buffer.from(config.encryption.key, 'hex');

/**
 * Encrypt a plaintext string using AES-256-GCM
 * @param {string} plaintext - The text to encrypt
 * @returns {{ encrypted: string, iv: string }} - Base64 encoded ciphertext and IV
 */
export function encrypt(plaintext) {
  if (!plaintext) return { encrypted: '', iv: '' };
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  // Combine encrypted data with auth tag
  const combined = Buffer.concat([
    Buffer.from(encrypted, 'base64'),
    authTag,
  ]).toString('base64');
  
  return {
    encrypted: combined,
    iv: iv.toString('base64'),
  };
}

/**
 * Decrypt a ciphertext string using AES-256-GCM
 * @param {string} encryptedData - Base64 encoded ciphertext + auth tag
 * @param {string} ivString - Base64 encoded IV
 * @returns {string} - Decrypted plaintext
 */
export function decrypt(encryptedData, ivString) {
  if (!encryptedData || !ivString) return '';
  
  const iv = Buffer.from(ivString, 'base64');
  const combined = Buffer.from(encryptedData, 'base64');
  
  // Extract auth tag from the end
  const authTag = combined.subarray(combined.length - TAG_LENGTH);
  const encrypted = combined.subarray(0, combined.length - TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, null, 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generate a random encryption key (for setup)
 * @returns {string} - 64-character hex string (32 bytes)
 */
export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}
