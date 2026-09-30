export const munusConfig = {
  apiBaseUrl: (import.meta.env.VITE_MUNUS_API_BASE_URL ?? '').replace(/\/$/, ''),
  localDevelopmentAuth: import.meta.env.VITE_MUNUS_LOCAL_AUTH === 'true',
  sessionMode: import.meta.env.VITE_MUNUS_SESSION_MODE === 'remote' ? 'remote' : 'local',
} as const
