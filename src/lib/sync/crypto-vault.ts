/**
 * Pure-frontend End-to-End Encryption (E2EE) vault for optional API Key sync over WebDAV.
 *
 * Cryptography specification:
 * - KDF: PBKDF2-HMAC-SHA256, 600,000 iterations, random 16-byte salt per encryption
 * - Cipher: AES-256-GCM (AEAD), random 12-byte IV per encryption, 128-bit auth tag
 * - AAD: Deterministic protocol/version/KDF/cipher metadata bound into GCM auth tag
 * - Session storage: Passphrase may live only in browser `sessionStorage` (cleared when tab closes),
 *   NEVER persisted to `localStorage` and NEVER uploaded to WebDAV.
 */

export const VAULT_VERSION = 1 as const;
export const VAULT_KDF = 'PBKDF2-SHA256' as const;
export const VAULT_ITERATIONS = 600_000;
export const VAULT_CIPHER = 'AES-256-GCM' as const;
export const MIN_PASSPHRASE_LENGTH = 8;

const SESSION_PASSPHRASE_KEY = 'studying-mate-webdav-vault-passphrase-session';

export interface EncryptedApiKeysVault {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-256-GCM';
  salt: string;
  iv: string;
  aad: string;
  ciphertext: string;
  keyCount: number;
  updatedAt: number;
}

export interface ApiKeyRecord {
  apiKey: string;
  updatedAt: number;
}

export interface ApiKeysVaultPlaintext {
  schema: 'api-keys-v1';
  keys: Record<string, ApiKeyRecord>;
}

export type VaultCryptoErrorCode =
  | 'unsupported_env'
  | 'weak_passphrase'
  | 'invalid_envelope'
  | 'wrong_passphrase';

export class VaultCryptoError extends Error {
  code: VaultCryptoErrorCode;

  constructor(code: VaultCryptoErrorCode, message: string) {
    super(message);
    this.name = 'VaultCryptoError';
    this.code = code;
  }
}

function getSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new VaultCryptoError(
      'unsupported_env',
      '当前浏览器环境不支持 Web Crypto API（请通过 HTTPS 或 localhost 访问）',
    );
  }
  return subtle;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(b64);
    const buf = new ArrayBuffer(binary.length);
    const out = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    throw new VaultCryptoError('invalid_envelope', '云端密钥保险库 Base64 数据格式损坏');
  }
}

function buildVaultAad(iterations: number): string {
  return `studying-mate:apikeys:v${VAULT_VERSION}:${VAULT_KDF}:${iterations}:${VAULT_CIPHER}`;
}

async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    [usage],
  );
}

export function isEncryptedApiKeysVault(val: unknown): val is EncryptedApiKeysVault {
  if (!val || typeof val !== 'object') return false;
  const v = val as Record<string, unknown>;
  return (
    v.version === 1 &&
    v.kdf === VAULT_KDF &&
    v.cipher === VAULT_CIPHER &&
    typeof v.iterations === 'number' &&
    typeof v.salt === 'string' &&
    typeof v.iv === 'string' &&
    typeof v.aad === 'string' &&
    typeof v.ciphertext === 'string'
  );
}

/**
 * Encrypts a map of providerId -> { apiKey, updatedAt } into a self-describing AES-256-GCM envelope.
 */
export async function encryptApiKeysVault(
  keys: Record<string, ApiKeyRecord>,
  passphrase: string,
): Promise<EncryptedApiKeysVault> {
  const trimmedPass = passphrase.trim();
  if (trimmedPass.length < MIN_PASSPHRASE_LENGTH) {
    throw new VaultCryptoError(
      'weak_passphrase',
      `同步主口令长度至少需要 ${MIN_PASSPHRASE_LENGTH} 位（建议 10 位以上包含字母与数字）`,
    );
  }

  const subtle = getSubtleCrypto();
  const salt = new Uint8Array(new ArrayBuffer(16));
  const iv = new Uint8Array(new ArrayBuffer(12));
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);

  const aad = buildVaultAad(VAULT_ITERATIONS);
  const encoder = new TextEncoder();
  const plaintextObj: ApiKeysVaultPlaintext = {
    schema: 'api-keys-v1',
    keys,
  };
  const plaintextBytes = encoder.encode(JSON.stringify(plaintextObj));
  const aadBytes = encoder.encode(aad);

  const aesKey = await deriveAesKey(trimmedPass, salt, VAULT_ITERATIONS, 'encrypt');
  const cipherBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aadBytes,
      tagLength: 128,
    },
    aesKey,
    plaintextBytes,
  );

  return {
    version: VAULT_VERSION,
    kdf: VAULT_KDF,
    iterations: VAULT_ITERATIONS,
    cipher: VAULT_CIPHER,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    aad,
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    keyCount: Object.keys(keys).length,
    updatedAt: Date.now(),
  };
}

/**
 * Decrypts and authenticates an EncryptedApiKeysVault using the user's sync passphrase.
 */
export async function decryptApiKeysVault(
  vault: EncryptedApiKeysVault,
  passphrase: string,
): Promise<ApiKeysVaultPlaintext> {
  if (!isEncryptedApiKeysVault(vault)) {
    throw new VaultCryptoError('invalid_envelope', '云端 API Key 保险库格式无效或版本不受支持');
  }
  if (vault.iterations < 100_000 || vault.iterations > 5_000_000) {
    throw new VaultCryptoError('invalid_envelope', '云端保险库 KDF 迭代次数不在安全范围内');
  }
  const expectedAad = buildVaultAad(vault.iterations);
  if (vault.aad !== expectedAad) {
    throw new VaultCryptoError('invalid_envelope', '云端保险库元数据校验失败，可能已被篡改');
  }

  const trimmedPass = passphrase.trim();
  if (!trimmedPass) {
    throw new VaultCryptoError('wrong_passphrase', '请输入同步主口令以解密云端 API Key');
  }

  const subtle = getSubtleCrypto();
  const salt = base64ToBytes(vault.salt);
  const iv = base64ToBytes(vault.iv);
  const ciphertext = base64ToBytes(vault.ciphertext);

  if (salt.byteLength < 12 || iv.byteLength !== 12 || ciphertext.byteLength < 17) {
    throw new VaultCryptoError('invalid_envelope', '云端保险库加密参数长度异常');
  }

  const aesKey = await deriveAesKey(trimmedPass, salt, vault.iterations, 'decrypt');
  const aadBytes = new TextEncoder().encode(vault.aad);

  let plainBuffer: ArrayBuffer;
  try {
    plainBuffer = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aadBytes,
        tagLength: 128,
      },
      aesKey,
      ciphertext,
    );
  } catch {
    throw new VaultCryptoError(
      'wrong_passphrase',
      '同步主口令错误，或云端密钥保险库数据已损坏（无法通过 AES-GCM 认证校验）',
    );
  }

  try {
    const decoded = new TextDecoder().decode(plainBuffer);
    const parsed = JSON.parse(decoded) as ApiKeysVaultPlaintext;
    if (parsed?.schema !== 'api-keys-v1' || !parsed.keys || typeof parsed.keys !== 'object') {
      throw new Error('invalid schema');
    }
    return parsed;
  } catch {
    throw new VaultCryptoError('invalid_envelope', '解密成功但内部密钥载荷格式损坏');
  }
}

export function evaluatePassphraseStrength(passphrase: string): {
  level: 'empty' | 'weak' | 'fair' | 'good' | 'strong';
  label: string;
} {
  const p = passphrase.trim();
  if (!p) return { level: 'empty', label: '未填写' };
  if (p.length < MIN_PASSPHRASE_LENGTH) {
    return { level: 'weak', label: `过短（至少 ${MIN_PASSPHRASE_LENGTH} 位）` };
  }
  let variety = 0;
  if (/[a-z]/.test(p)) variety++;
  if (/[A-Z]/.test(p)) variety++;
  if (/\d/.test(p)) variety++;
  if (/[^A-Za-z0-9]/.test(p)) variety++;

  if (p.length >= 12 && variety >= 3) return { level: 'strong', label: '强' };
  if (p.length >= 10 && variety >= 2) return { level: 'good', label: '较强' };
  return { level: 'fair', label: '一般（建议 10 位以上并混合字母数字）' };
}

/**
 * Session-scoped passphrase storage (cleared automatically when the browser tab/session ends).
 * NEVER uses localStorage and NEVER exported to WebDAV.
 */
export function getSessionVaultPassphrase(): string {
  try {
    return typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(SESSION_PASSPHRASE_KEY) || ''
      : '';
  } catch {
    return '';
  }
}

export function setSessionVaultPassphrase(passphrase: string): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (!passphrase) {
      sessionStorage.removeItem(SESSION_PASSPHRASE_KEY);
    } else {
      sessionStorage.setItem(SESSION_PASSPHRASE_KEY, passphrase);
    }
  } catch {
    // ignore storage quota/privacy restrictions
  }
}

export function clearSessionVaultPassphrase(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SESSION_PASSPHRASE_KEY);
    }
  } catch {
    // ignore
  }
}
