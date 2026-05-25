import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ProcessCreateOptions {
  instanceId: string
  romPath: string
  port: number
  mgbaBinary: string
  luaScriptPath: string
  frameDir: string
}

export interface ProcessInfo {
  pid: number
  port: number
  process: ChildProcess
}

export class ProcessDriver {
  async spawn(opts: ProcessCreateOptions): Promise<ProcessInfo> {
    const frameDir = join(opts.frameDir, opts.instanceId)
    await mkdir(frameDir, { recursive: true })

    const loaderPath = join(frameDir, 'loader.lua')
    const loaderContent = `port = ${opts.port}\ndofile("${opts.luaScriptPath}")\n`
    await writeFile(loaderPath, loaderContent)

    const child = spawn(opts.mgbaBinary, ['--script', loaderPath, opts.romPath], {
      env: { ...process.env, DISPLAY: ':99', SDL_AUDIODRIVER: 'dummy' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    if (!child.pid) {
      throw new Error(`Failed to spawn ${opts.mgbaBinary}`)
    }

    child.stdout?.resume()
    child.stderr?.resume()

    child.on('error', () => undefined)

    return { pid: child.pid, port: opts.port, process: child }
  }

  async kill(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM')
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            undefined
          }
          resolve()
        }, 5000)
        const check = setInterval(() => {
          try {
            process.kill(pid, 0)
          } catch {
            clearInterval(check)
            clearTimeout(timeout)
            resolve()
          }
        }, 100)
      })
    } catch {
      undefined
    }
  }
}
