import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  withCredentials: true,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

export async function fetchHealth() {
  const res = await apiClient.get('/health');
  return res.data.data;
}
