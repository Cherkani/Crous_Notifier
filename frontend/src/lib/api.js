import axios from 'axios'

const defaultApiBaseUrl =
  window.location.port === '5173'
    ? 'http://localhost:4100/api'
    : '/api'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || defaultApiBaseUrl

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
})

export async function getState() {
  const response = await api.get('/state')
  return response.data
}

export function socketBaseUrl() {
  return API_BASE_URL.replace(/\/api\/?$/, '')
}
