export type InstanceStatus = 'starting' | 'running' | 'stopped' | 'error'

export interface InstanceInfo {
  id: string
  token: string
  containerId: string
  containerHost: string
  status: InstanceStatus
  createdAt: Date
}
