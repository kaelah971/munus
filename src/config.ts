export interface MunusClientConfig {
  apiBaseUrl: string
  localDevelopmentAuth: boolean
  productionAuth: boolean
  sessionMode: 'remote' | 'local'
}

export interface MunusClientEnv {
  PROD?: boolean
  VITE_MUNUS_API_BASE_URL?: string
  VITE_MUNUS_LOCAL_AUTH?: string
  VITE_MUNUS_PRODUCTION_AUTH?: string
  VITE_MUNUS_SESSION_MODE?: string
}

export function resolveMunusConfig(env: MunusClientEnv): MunusClientConfig {
  const requestedLocalDevelopmentAuth = env.VITE_MUNUS_LOCAL_AUTH === 'true'
  const productionBuild = env.PROD === true
  const productionAuth = productionBuild || env.VITE_MUNUS_PRODUCTION_AUTH === 'true'

  return {
    apiBaseUrl: (env.VITE_MUNUS_API_BASE_URL ?? '').replace(/\/$/, ''),
    localDevelopmentAuth: requestedLocalDevelopmentAuth && !productionAuth,
    productionAuth,
    sessionMode: env.VITE_MUNUS_SESSION_MODE === 'remote' || productionAuth
      ? 'remote'
      : 'local',
  }
}

export const munusConfig = resolveMunusConfig({
  PROD: import.meta.env.PROD,
  VITE_MUNUS_API_BASE_URL: import.meta.env.VITE_MUNUS_API_BASE_URL,
  VITE_MUNUS_LOCAL_AUTH: import.meta.env.VITE_MUNUS_LOCAL_AUTH,
  VITE_MUNUS_PRODUCTION_AUTH: import.meta.env.VITE_MUNUS_PRODUCTION_AUTH,
  VITE_MUNUS_SESSION_MODE: import.meta.env.VITE_MUNUS_SESSION_MODE,
})
