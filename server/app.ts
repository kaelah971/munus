import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { MunusSession } from '../src/domain/auth'
import type { MunusServerConfig } from './config'
import { MunusAuthService, AuthServiceError } from './authService'
import type { MunusRepository } from './repository'
import {
  PlanningRepositoryError,
  type PlanningRepository,
} from './planningRepository'
import {
  PlanningValidationError,
  parseAllocation,
  parsePocketDraft,
  parsePocketUpdate,
  parseReminderDraft,
  parseReminderStatus,
  parseSpendRuleDraft,
} from './planningValidation'
import {
  RequestValidationError,
  parsePreferences,
  parseProfileDraft,
} from './validation'

const MAX_BODY_BYTES = 16 * 1024

export interface MunusServerDependencies {
  repository: MunusRepository
  planning: PlanningRepository
  auth: MunusAuthService
  config: Pick<
    MunusServerConfig,
    'cookieName' | 'cookieSecure' | 'defaultNetwork' | 'corsOrigin'
  >
}

export function createMunusServer(dependencies: MunusServerDependencies): Server {
  return createServer((request, response) => {
    void handleRequest(request, response, dependencies).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy()
        return
      }

      console.error('Munus API request failed', error)
      sendError(response, 500, 'Munus could not complete that request.')
    })
  })
}

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: MunusServerDependencies,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://munus.local')
  const { auth, repository, planning, config } = dependencies
  applyCorsHeaders(request, response, config.corsOrigin)

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  try {
    if (request.method === 'POST' && url.pathname === '/auth/challenge') {
      const body = await readJson(request)
      const input = asRecord(body)
      const challenge = await auth.createChallenge({
        walletAddress: requiredString(input.walletAddress, 'walletAddress'),
        network: parseNetwork(input.network, config.defaultNetwork),
      })
      sendJson(response, 201, challenge)
      return
    }

    if (request.method === 'POST' && url.pathname === '/auth/verify') {
      const body = await readJson(request)
      const input = asRecord(body)
      const verified = await auth.verifyChallenge({
        challengeId: requiredString(input.challengeId, 'challengeId'),
        walletAddress: requiredString(input.walletAddress, 'walletAddress'),
        publicKey: requiredString(input.publicKey, 'publicKey'),
        signature: requiredString(input.signature, 'signature'),
      })
      sendCookie(response, config.cookieName, verified.token, config.cookieSecure, verified.session.expiresAt)
      sendJson(response, 200, verified.session)
      return
    }

    if (request.method === 'GET' && url.pathname === '/auth/session') {
      const token = readCookie(request.headers.cookie, config.cookieName)
      const session = await auth.restoreSession(token)
      if (!session && token) clearCookie(response, config.cookieName, config.cookieSecure)
      sendJson(response, 200, { session })
      return
    }

    if (request.method === 'POST' && url.pathname === '/auth/logout') {
      const token = readCookie(request.headers.cookie, config.cookieName)
      await auth.revokeSession(token)
      clearCookie(response, config.cookieName, config.cookieSecure)
      response.writeHead(204)
      response.end()
      return
    }

    const pocketPath = matchPath(url.pathname, /^\/pockets(?:\/([^/]+))?(\/allocations)?$/)
    if (
      pocketPath &&
      ['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method ?? '')
    ) {
      const session = await requireSession(request, response, dependencies)
      if (!session) return
      const pocketId = pocketPath[1] ? decodeURIComponent(pocketPath[1]) : undefined
      const allocationPath = Boolean(pocketPath[2])

      if (!pocketId && request.method === 'GET') {
        const includeArchived = url.searchParams.get('includeArchived') === 'true'
        sendJson(response, 200, { pockets: await planning.listPockets(session.userId, includeArchived) })
        return
      }
      if (!pocketId && request.method === 'POST') {
        sendJson(response, 201, await planning.createPocket(session.userId, parsePocketDraft(await readJson(request))))
        return
      }
      if (pocketId && allocationPath && request.method === 'POST') {
        const allocation = await planning.addPocketAllocation(
          session.userId,
          pocketId,
          parseAllocation(await readJson(request)),
        )
        sendJson(response, 200, allocation)
        return
      }
      if (pocketId && !allocationPath && request.method === 'GET') {
        const pocket = await planning.getPocket(session.userId, pocketId)
        if (!pocket) {
          sendError(response, 404, 'Pocket was not found.')
          return
        }
        sendJson(response, 200, pocket)
        return
      }
      if (pocketId && !allocationPath && request.method === 'PATCH') {
        const current = await planning.getPocket(session.userId, pocketId)
        if (!current) {
          sendError(response, 404, 'Pocket was not found.')
          return
        }
        sendJson(response, 200, await planning.updatePocket(session.userId, pocketId, parsePocketUpdate(await readJson(request), current)))
        return
      }
      if (pocketId && !allocationPath && request.method === 'DELETE') {
        const archived = await planning.archivePocket(session.userId, pocketId)
        if (!archived) {
          sendError(response, 404, 'Pocket was not found.')
          return
        }
        sendJson(response, 200, archived)
        return
      }
    }

    if (
      (request.method === 'GET' || request.method === 'POST') &&
      url.pathname === '/reminders'
    ) {
      const session = await requireSession(request, response, dependencies)
      if (!session) return
      if (request.method === 'GET') {
        sendJson(response, 200, { reminders: await planning.listReminders(session.userId) })
        return
      }
      sendJson(response, 201, await planning.createReminder(session.userId, parseReminderDraft(await readJson(request))))
      return
    }

    const reminderPath = matchPath(url.pathname, /^\/reminders\/([^/]+)$/)
    if (reminderPath && ['PATCH', 'DELETE'].includes(request.method ?? '')) {
      const session = await requireSession(request, response, dependencies)
      if (!session) return
      const reminderId = decodeURIComponent(reminderPath[1])
      if (request.method === 'DELETE') {
        const deleted = await planning.deleteReminder(session.userId, reminderId)
        if (!deleted) {
          sendError(response, 404, 'Reminder was not found.')
          return
        }
        response.writeHead(204)
        response.end()
        return
      }
      const current = await planning.getReminder(session.userId, reminderId)
      if (!current) {
        sendError(response, 404, 'Reminder was not found.')
        return
      }
      const body = await readJson(request)
      const record = asRecord(body)
      const status = record.status === undefined ? current.status : parseReminderStatus(record.status)
      const updated = await planning.updateReminder(
        session.userId,
        reminderId,
        parseReminderDraft(body, current),
        status,
      )
      sendJson(response, 200, updated)
      return
    }

    if (
      (request.method === 'GET' || request.method === 'POST') &&
      url.pathname === '/spend-rules'
    ) {
      const session = await requireSession(request, response, dependencies)
      if (!session) return
      if (request.method === 'GET') {
        sendJson(response, 200, { spendRules: await planning.listSpendRules(session.userId) })
        return
      }
      sendJson(response, 201, await planning.createSpendRule(session.userId, parseSpendRuleDraft(await readJson(request))))
      return
    }

    const spendRulePath = matchPath(url.pathname, /^\/spend-rules\/([^/]+)$/)
    if (spendRulePath && ['PATCH', 'DELETE'].includes(request.method ?? '')) {
      const session = await requireSession(request, response, dependencies)
      if (!session) return
      const ruleId = decodeURIComponent(spendRulePath[1])
      if (request.method === 'DELETE') {
        const deleted = await planning.deleteSpendRule(session.userId, ruleId)
        if (!deleted) {
          sendError(response, 404, 'Spend rule was not found.')
          return
        }
        response.writeHead(204)
        response.end()
        return
      }
      const current = await planning.getSpendRule(session.userId, ruleId)
      if (!current) {
        sendError(response, 404, 'Spend rule was not found.')
        return
      }
      sendJson(response, 200, await planning.updateSpendRule(session.userId, ruleId, parseSpendRuleDraft(await readJson(request), current)))
      return
    }

    if (
      (request.method === 'GET' || request.method === 'PUT' || request.method === 'PATCH') &&
      url.pathname === '/preferences'
    ) {
      const session = await requireSession(request, response, dependencies)
      if (!session) return

      const currentPreferences = await repository.getPreferences(session.userId)
      if (request.method === 'GET') {
        sendJson(response, 200, currentPreferences)
        return
      }

      const preferences = await repository.savePreferences(
        parsePreferences(await readJson(request), currentPreferences),
      )
      sendJson(response, 200, preferences)
      return
    }

    if (
      (request.method === 'GET' || request.method === 'PUT' || request.method === 'PATCH') &&
      url.pathname === '/profile'
    ) {
      const session = await requireSession(request, response, dependencies)
      if (!session) return

      if (request.method === 'GET') {
        const profile = await repository.getProfile(session.userId)
        if (!profile) {
          sendJson(response, 404, { error: 'Profile has not been created yet.' })
          return
        }
        sendJson(response, 200, profile)
        return
      }

      const profile = await repository.saveProfile(session.userId, parseProfileDraft(await readJson(request)))
      sendJson(response, 200, profile)
      return
    }

    sendError(response, 404, 'Munus route not found.')
  } catch (error: unknown) {
    if (
      error instanceof AuthServiceError ||
      error instanceof RequestValidationError ||
      error instanceof PlanningValidationError ||
      error instanceof PlanningRepositoryError
    ) {
      const statusCode = error instanceof AuthServiceError || error instanceof PlanningRepositoryError
        ? error.statusCode
        : 400
      sendError(response, statusCode, error.message)
      return
    }

    throw error
  }
}

async function requireSession(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: MunusServerDependencies,
): Promise<MunusSession | null> {
  const token = readCookie(request.headers.cookie, dependencies.config.cookieName)
  const session = await dependencies.auth.restoreSession(token)
  if (session) return session

  sendError(response, 401, 'Munus session is required.')
  return null
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new RequestValidationError('Request body is too large.')
    }
    chunks.push(buffer)
  }

  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new RequestValidationError('Request body must be valid JSON.')
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestValidationError('Request body must be an object.')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RequestValidationError(`${name} is required.`)
  }
  return value.trim()
}

function matchPath(path: string, pattern: RegExp): RegExpMatchArray | null {
  return path.match(pattern)
}

function parseNetwork(value: unknown, fallback: 'mainnet' | 'testnet'): 'mainnet' | 'testnet' {
  if (value === undefined) return fallback
  if (value !== 'mainnet' && value !== 'testnet') {
    throw new RequestValidationError('network must be mainnet or testnet.')
  }
  return value
}

function applyCorsHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigin?: string,
): void {
  const origin = request.headers.origin
  if (!allowedOrigin || origin !== allowedOrigin) return

  response.setHeader('access-control-allow-origin', allowedOrigin)
  response.setHeader('access-control-allow-credentials', 'true')
  response.setHeader('access-control-allow-headers', 'content-type')
  response.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,OPTIONS')
  response.setHeader('vary', 'Origin')
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(body)
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message })
}

function sendCookie(
  response: ServerResponse,
  name: string,
  token: string,
  secure: boolean,
  expiresAt: number,
): void {
  const attributes = [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ]
  if (secure) attributes.push('Secure')
  response.setHeader('set-cookie', attributes.join('; '))
}

function clearCookie(response: ServerResponse, name: string, secure: boolean): void {
  const attributes = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) attributes.push('Secure')
  response.setHeader('set-cookie', attributes.join('; '))
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null

  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=')
    if (key === name) {
      return decodeURIComponent(valueParts.join('='))
    }
  }

  return null
}
