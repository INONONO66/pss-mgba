import { randomBytes } from 'node:crypto'

const TOKEN_PATTERN = /^[0-9a-f]{32}$/

export function generateToken(): string {
  return randomBytes(16).toString('hex')
}

export function isValidTokenFormat(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}
