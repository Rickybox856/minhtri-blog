// Đặt (hoặc đặt lại khi quên) mật khẩu quản trị trực tiếp trong D1.
//   npm run admin:password            (hỏi mật khẩu, ghi vào D1 thật)
//   npm run admin:password -- --local (ghi vào D1 local)
// Đổi mật khẩu bình thường thì dùng trang /quan-tri/doi-mat-khau.
import { execSync } from 'node:child_process'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'

const ITERATIONS = 100_000 // phải khớp src/lib/auth.ts
const local = process.argv.includes('--local')

const rl = createInterface({ input: process.stdin, output: process.stdout })
const password = (await rl.question('Mật khẩu mới (ít nhất 10 ký tự): ')).trim()
rl.close()
if (password.length < 10) {
  console.error('Mật khẩu quá ngắn.')
  process.exit(1)
}

const salt = randomBytes(16)
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256')
const stored = `pbkdf2$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`
const sessionKey = randomBytes(32).toString('base64')

const dir = mkdtempSync(join(tmpdir(), 'admin-'))
const file = join(dir, 'set.sql')
writeFileSync(
  file,
  `INSERT INTO settings (key, value) VALUES ('admin_password_hash', '${stored}'), ('session_key', '${sessionKey}')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now');\n`
)
try {
  execSync(`npx wrangler d1 execute DB ${local ? '--local' : '--remote'} --file="${file}"`, {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  console.log(`✔ Đã đặt mật khẩu quản trị (${local ? 'local' : 'site thật'}). Mọi phiên đăng nhập cũ đã bị huỷ.`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
