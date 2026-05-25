export type InstanceStatus = 'starting' | 'running' | 'stopped' | 'error'

export interface InstanceInfo {
  id: string
  token: string
  pid: number
  port: number
  framePath: string
  status: InstanceStatus
  createdAt: Date
}
