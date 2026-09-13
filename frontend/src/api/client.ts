export interface HealthResponse {
  status: string
  python: string
}

async function request<T>(path: string): Promise<T> {
  const baseUrl = import.meta.env.VITE_API_URL
  if (!baseUrl) {
    throw new Error('VITE_API_URL environment variable is not set')
  }
  const response = await fetch(`${baseUrl}${path}`)
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}: ${body}`)
  }
  return JSON.parse(body)
}

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health')
}
