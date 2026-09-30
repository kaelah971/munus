import { createClient } from '@supabase/supabase-js'
import { createMunusServer } from './app'
import { MunusAuthService } from './authService'
import { loadServerConfig } from './config'
import { SupabaseMunusRepository } from './repository'

const config = loadServerConfig()
const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const repository = new SupabaseMunusRepository(supabase)
const auth = new MunusAuthService(repository, {
  challengeTtlMs: config.challengeTtlMs,
  sessionTtlMs: config.sessionTtlMs,
})
const server = createMunusServer({ repository, auth, config })

server.listen(config.port, () => {
  console.log(`Munus API listening on http://localhost:${config.port}`)
})
