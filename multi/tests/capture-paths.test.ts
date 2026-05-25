import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isPathInside, isSafeCaptureDirectory, readCaptureFile } from '../src/instances/capturePaths.js'

let tempRoot: string
let captureRoot: string
let outsideRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pss-mgba-capture-paths-'))
  captureRoot = path.join(tempRoot, 'captures')
  outsideRoot = path.join(tempRoot, 'outside')
  await mkdir(captureRoot)
  await mkdir(outsideRoot)
})

afterEach(async () => {
  await rm(tempRoot, { force: true, recursive: true })
})

describe('capture path guards', () => {
  it('checks lexical containment without accepting the root itself', () => {
    expect(isPathInside(captureRoot, path.join(captureRoot, 'instance-a'))).toBe(true)
    expect(isPathInside(captureRoot, captureRoot)).toBe(false)
    expect(isPathInside(captureRoot, path.join(tempRoot, 'outside'))).toBe(false)
  })


  it('accepts real capture directories when captureRoot is a symlink alias', async () => {
    const rootAlias = path.join(tempRoot, 'captures-alias')
    await symlink(captureRoot, rootAlias)
    const captureDirectory = path.join(captureRoot, 'instance-a')
    await mkdir(captureDirectory)

    await expect(isSafeCaptureDirectory(captureDirectory, rootAlias)).resolves.toBe(true)
  })

  it('rejects symlinked capture directories that escape the capture root', async () => {
    const outsideCapture = path.join(outsideRoot, 'instance-a')
    await mkdir(outsideCapture)
    const symlinkedCapture = path.join(captureRoot, 'instance-a')
    await symlink(outsideCapture, symlinkedCapture)

    await expect(isSafeCaptureDirectory(symlinkedCapture, captureRoot)).resolves.toBe(false)
    await expect(readCaptureFile(symlinkedCapture, 'frame.png')).rejects.toThrow('Capture directory is not a directory')
  })

  it('reads regular capture files inside a real capture directory', async () => {
    const captureDirectory = path.join(captureRoot, 'instance-a')
    await mkdir(captureDirectory)
    await writeFile(path.join(captureDirectory, 'frame.png'), Buffer.from('rgba-frame'))

    await expect(isSafeCaptureDirectory(captureDirectory, captureRoot)).resolves.toBe(true)
    await expect(readCaptureFile(captureDirectory, 'frame.png')).resolves.toEqual(Buffer.from('rgba-frame'))
  })


  it('rejects oversized capture files before reading them', async () => {
    const captureDirectory = path.join(captureRoot, 'instance-a')
    await mkdir(captureDirectory)
    await writeFile(path.join(captureDirectory, 'frame.png'), Buffer.alloc(8 * 1024 * 1024 + 1))

    await expect(readCaptureFile(captureDirectory, 'frame.png')).rejects.toThrow('Capture file exceeds maximum size')
  })

  it('rejects symlinked capture files', async () => {
    const captureDirectory = path.join(captureRoot, 'instance-a')
    await mkdir(captureDirectory)
    const outsideFrame = path.join(outsideRoot, 'frame.png')
    await writeFile(outsideFrame, Buffer.from('outside-frame'))
    await symlink(outsideFrame, path.join(captureDirectory, 'frame.png'))

    await expect(readCaptureFile(captureDirectory, 'frame.png')).rejects.toThrow('Capture path is not a regular file')
  })
})
