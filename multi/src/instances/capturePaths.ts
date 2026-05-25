import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'

const MAX_CAPTURE_FILE_BYTES = 8 * 1024 * 1024

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export async function isSafeCaptureDirectory(captureDirectory: string, captureRoot: string): Promise<boolean> {
  try {
    const stats = await lstat(captureDirectory)
    if (!stats.isDirectory()) {
      return false
    }

    const realRoot = await realpath(captureRoot)
    const realDirectory = await realpath(captureDirectory)
    return isPathInside(realRoot, realDirectory)
  } catch {
    return false
  }
}

export async function readCaptureFile(captureDirectory: string, fileName: string): Promise<Buffer> {
  const directoryStats = await lstat(captureDirectory)
  if (!directoryStats.isDirectory()) {
    throw new Error('Capture directory is not a directory')
  }

  const captureFile = path.resolve(captureDirectory, fileName)
  if (!isPathInside(captureDirectory, captureFile)) {
    throw new Error('Capture file escaped capture directory')
  }

  const stats = await lstat(captureFile)
  if (!stats.isFile()) {
    throw new Error('Capture path is not a regular file')
  }
  if (stats.size > MAX_CAPTURE_FILE_BYTES) {
    throw new Error('Capture file exceeds maximum size')
  }

  const noFollowReadFlags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  const handle = await open(captureFile, noFollowReadFlags)
  try {
    const openStats = await handle.stat()
    if (!openStats.isFile()) {
      throw new Error('Capture handle is not a regular file')
    }
    if (openStats.size > MAX_CAPTURE_FILE_BYTES) {
      throw new Error('Capture file exceeds maximum size')
    }

    if (stats.dev !== openStats.dev || stats.ino !== openStats.ino) {
      throw new Error('Capture file changed while opening')
    }

    return await handle.readFile()
  } finally {
    await handle.close()
  }
}
