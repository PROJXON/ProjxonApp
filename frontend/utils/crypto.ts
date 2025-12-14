import { secp256k1 } from '@noble/curves/secp256k1';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { gcm } from '@noble/ciphers/aes.js';

const PRIVATE_KEY_STORAGE_KEY = '@private_key';
const PUBLIC_KEY_STORAGE_KEY = '@public_key';

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export const generateKeypair = async (): Promise<KeyPair> => {
  try {
    console.log('Generating new cryptography keypair...')
    const privateKeyBytes = getRandomBytes(32);
    let attempts = 0;
    let validPrivatekey = privateKeyBytes;

    while (attempts < 10) {
      try {
        const publicKeyPoint = secp256k1.getPublicKey(validPrivatekey, false);


        return {
          privateKey: bytesToHex(validPrivatekey),
          publicKey: bytesToHex(publicKeyPoint),
        }
      } catch (error) {
        validPrivatekey = getRandomBytes(32);
        attempts++;
      }
    }
    throw new Error('Failed to generate valid keypair after 10 attempts');
  } catch (error) {
    console.error('Error generating keypair:', error);
    throw new Error('Failed to generate keypair');
  }
};

export const storeKeyPair = async (userId: string, keypair: KeyPair) => {
  try {
    const keyData = JSON.stringify(keypair);
    await SecureStore.setItemAsync(`crypto_keys_${userId}`, keyData);
    console.log(`Keys stored for ${userId}`);
  } catch (error) {
    console.error('Error storing keys:', error);
    throw new Error('Failed to store keys');
  }
};

export const loadKeyPair = async(userId: string): Promise<KeyPair | null> => {
  try {
    const keyData = await SecureStore.getItemAsync(`crypto_keys_${userId}`);
    if (!keyData) return null;
    return JSON.parse(keyData);
  } catch (error) {
    console.error('Error loading keys:', error);
    return null;
  }
};

export const derivePublicKey = (privateKeyHex: string): string => {
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const publicKeyPoint = secp256k1.getPublicKey(privateKeyBytes, false);
  return bytesToHex(publicKeyPoint);
};

export interface BackupBlob {
  ciphertext: string;
  iv: string;
  salt: string;
}

const deriveBackupKey = (passphrase: string, salt: Uint8Array) =>
  pbkdf2(sha256, new TextEncoder().encode(passphrase), salt, { c: 100000, dkLen: 32 });

export const encryptPrivateKey = async (privateKeyHex: string, passphrase: string): Promise<BackupBlob> => {
  const salt = getRandomBytes(16);
  const key = deriveBackupKey(passphrase, salt);
  const iv = getRandomBytes(12);
  const cipher = gcm(key, iv);
  const encrypted = cipher.encrypt(hexToBytes(privateKeyHex));
  const ciphertext = encrypted.slice(0, -16);
  const authTag = encrypted.slice(-16);
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);
  return {
    ciphertext: bytesToHex(combined),
    iv: bytesToHex(iv),
    salt: bytesToHex(salt),
  };
};

export const decryptPrivateKey = async (blob: BackupBlob, passphrase: string): Promise<string> => {
  const salt = hexToBytes(blob.salt);
  const iv = hexToBytes(blob.iv);
  const combined = hexToBytes(blob.ciphertext);
  const key = deriveBackupKey(passphrase, salt);
  const cipher = gcm(key, iv);
  const decrypted = cipher.decrypt(combined);
  return bytesToHex(decrypted);
};