import crypto from 'crypto'

/**
 * Hashing passwords using Node's pbkdf2 standard library.
 * Secure, fast, and does not require native node-gyp compilation (unlike bcrypt).
 */

const ITERATIONS = 10000
const KEY_LENGTH = 64
const ALGORITHM = 'sha512'

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto
    .pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, ALGORITHM)
    .toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':')
  if (!salt || !hash) return false
  const checkHash = crypto
    .pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, ALGORITHM)
    .toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(checkHash, 'hex'))
}
