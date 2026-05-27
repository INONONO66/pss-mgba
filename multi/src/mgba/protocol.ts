export const TERMINATION_MARKER = '<|END|>'
export const SUCCESS_MARKER = '<|SUCCESS|>'
export const ERROR_MARKER = '<|ERROR|>'
export const ACK_MESSAGE = '<|ACK|>'

export function formatMessage(type: string, ...args: string[]): string {
  const body = args.length > 0 ? [type, ...args].join(',') : type
  return `${body}${TERMINATION_MARKER}`
}

interface ParsedResponse {
  value: string
  isSuccess: boolean
  isError: boolean
}

export function parseResponse(raw: string): ParsedResponse {
  const value = raw.endsWith(TERMINATION_MARKER)
    ? raw.slice(0, -TERMINATION_MARKER.length)
    : raw

  return {
    value,
    isSuccess: value === SUCCESS_MARKER,
    isError: value === ERROR_MARKER,
  }
}
