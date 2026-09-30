import type { MunusProfile, ProfileDraft } from '../domain/profile'

export interface ProfileApi {
  getProfile(): Promise<MunusProfile | null>
  saveProfile(draft: ProfileDraft): Promise<MunusProfile>
}

/**
 * Production boundary for the authenticated API. The server derives the user
 * from the HttpOnly session and never trusts a client-supplied user id.
 */
export class RemoteProfileApi implements ProfileApi {
  constructor(private readonly baseUrl: string) {}

  async getProfile(): Promise<MunusProfile | null> {
    const response = await this.request('/profile', { method: 'GET' })
    if (response.status === 404) return null
    return this.readJson<MunusProfile>(response)
  }

  async saveProfile(draft: ProfileDraft): Promise<MunusProfile> {
    const response = await this.request('/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    })
    return this.readJson<MunusProfile>(response)
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      credentials: 'include',
    })
    if (!response.ok && response.status !== 404) {
      throw new Error(`Munus profile request failed (${response.status}).`)
    }
    return response
  }

  private async readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T
  }
}
