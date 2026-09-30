import { createClient } from '@supabase/supabase-js'
import { resolve } from 'node:path'
import { createMunusServer } from './app'
import { MunusAuthService } from './authService'
import { loadServerConfig } from './config'
import { SupabaseMunusRepository } from './repository'
import { SupabasePlanningRepository } from './planningRepository'
import { SupabaseSupportRepository } from './supportRepository'

const config = loadServerConfig()
const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const repository = new SupabaseMunusRepository(supabase)
const planning = new SupabasePlanningRepository(supabase)
const support = new SupabaseSupportRepository(supabase)
const auth = new MunusAuthService(repository, {
  challengeTtlMs: config.challengeTtlMs,
  sessionTtlMs: config.sessionTtlMs,
})
const server = createMunusServer({
  repository,
  planning,
  support,
  auth,
  staticDir: resolve(process.cwd(), 'dist'),
  config,
})

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Munus listening on port ${config.port}`)
})
