import Dockerode from 'dockerode'

const LEADING_SLASH = /^\//

function ignoreDockerError(): void {
  return
}

export interface ContainerCreateOptions {
  image: string
  instanceId: string
  romPath?: string
  networkName: string
  emulatorPort: number
}

export interface ContainerInfo {
  id: string
  host: string
  port: number
}

export class DockerDriver {
  private readonly docker: Dockerode

  constructor() {
    this.docker = new Dockerode()
  }

  async createContainer(opts: ContainerCreateOptions): Promise<ContainerInfo> {
    const containerName = `pss-mgba-${opts.instanceId}`
    const createOptions: Dockerode.ContainerCreateOptions = {
      Image: opts.image,
      name: containerName,
      Labels: {
        'pss-mgba.instance-id': opts.instanceId,
        'pss-mgba.managed': 'true',
      },
      Env: ['DISPLAY=:99'],
      HostConfig: {
        NetworkMode: opts.networkName,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=64m',
        },
        ...(opts.romPath ? { Binds: [`${opts.romPath}:/rom/game.gb:ro`] } : {}),
      },
      ...(opts.romPath ? { Volumes: { '/rom/game.gb': {} } } : {}),
    }

    const container = await this.docker.createContainer(createOptions)
    await container.start()

    return { id: container.id, host: containerName, port: opts.emulatorPort }
  }

  async stopContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId)
    await container.stop({ t: 5 }).catch(ignoreDockerError)
    await container.remove({ force: true })
  }

  async listManagedContainers(): Promise<Array<{ id: string; instanceId: string; host: string }>> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: ['pss-mgba.managed=true'] },
    })

    return containers.flatMap((container) => {
        const instanceId = container.Labels?.['pss-mgba.instance-id']
        const host = container.Names?.[0]?.replace(LEADING_SLASH, '')
        if (instanceId === undefined || host === undefined || host === '') {
          return []
        }

        return [{ id: container.Id, instanceId, host }]
      })
  }

  async inspectContainer(containerId: string): Promise<{ running: boolean }> {
    const container = this.docker.getContainer(containerId)
    const info = await container.inspect()
    return { running: info.State.Running }
  }
}
