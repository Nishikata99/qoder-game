import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = path.resolve(import.meta.dirname)
const dataDir = path.join(root, 'src', 'data')
const backupDir = path.join(root, 'backups', 'editor')
const DATA_FILES = ['narrative.json', 'game.json', 'beats.json', 'cutscenes.json']

let building = null

/** vite preview(4180) 服务的是 dist，改完数据必须重建才能生效 */
function runBuild() {
  if (building) return building
  building = new Promise((resolve) => {
    const bin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
    const child = spawn(process.execPath, [bin, 'build', '--logLevel', 'warn'], { cwd: root, windowsHide: true })
    let out = ''
    const cap = (c) => { out = (out + c).slice(-8000) }
    child.stdout.on('data', cap)
    child.stderr.on('data', cap)
    child.on('error', (e) => { building = null; resolve({ ok: false, out: String(e) }) })
    child.on('close', (code) => {
      building = null
      resolve({ ok: code === 0, out: out.trim() })
    })
  })
  return building
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
}

function backupFile(file) {
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const dest = path.join(backupDir, `${stamp}-${path.basename(file)}`)
  fs.copyFileSync(file, dest)
  return dest
}

function validatePayload(name, body) {
  if (!DATA_FILES.includes(name)) return 'unknown data file'
  if (typeof body !== 'object' || body === null) return 'payload must be an object'
  if (name === 'narrative.json') {
    if (typeof body.bossName !== 'string' || !body.bossName.trim()) return 'bossName 不能为空'
    if (!Array.isArray(body.levelNarrative) || body.levelNarrative.length !== 3) return 'levelNarrative 必须是 3 项'
    for (const l of body.levelNarrative) {
      if (typeof l?.name !== 'string' || typeof l?.title !== 'string' || !l.name.trim() || !l.title.trim()) return '层级名字/标题不能为空'
    }
    if (typeof body.itemFlavor !== 'object' || body.itemFlavor === null) return 'itemFlavor 必须是对象'
    for (const [k, v] of Object.entries(body.itemFlavor)) {
      if (typeof v !== 'string' || !v.trim()) return `itemFlavor.${k} 不能为空`
    }
  }
  if (name === 'game.json') {
    if (!Array.isArray(body.levels) || body.levels.length !== 3) return 'levels 必须是 3 项'
    for (const l of body.levels) {
      for (const k of ['id', 'hp', 'playerHp', 'supply']) {
        if (!Number.isInteger(l?.[k]) || l[k] < 0) return `levels.${l.id ?? '?'}.${k} 必须是非负整数`
      }
      if (l.hp < 1) return '对手 hp 至少为 1'
      if (l.playerHp < 1) return '玩家 playerHp 至少为 1'
      if (l.supply > 8 || l.reloadSupply > 8) return '补给数不能超过 8（道具上限）'
      if (!['cautious', 'gambler', 'executioner'].includes(l.personality)) return 'personality 非法'
    }
    const w = body.trumpWeights
    if (typeof w !== 'object' || w === null) return 'trumpWeights 必须是对象'
    for (const [k, v] of Object.entries(w)) {
      if (typeof v !== 'number' || !(v >= 0) || v > 100) return `trumpWeights.${k} 必须在 0-100 之间`
    }
    const sf = body.sfxFiles
    if (typeof sf?.roomTone !== 'string' || typeof sf?.introDoor !== 'string' || typeof sf?.emptyClick !== 'string' || typeof sf?.cardDeal !== 'string') return 'sfxFiles 缺字段'
    for (const [k, v] of Object.entries(sf)) {
      if (!/^audio\/[\w.-]+\.(ogg|wav|mp3)$/.test(v)) return `sfxFiles.${k} 必须指向 audio/ 下的 ogg/wav/mp3`
      // room-tone 可能尚未提供文件：缺失时引擎静默回落到合成底噪，只警告不拒绝
      if (!fs.existsSync(path.join(root, 'public', v)) && k !== 'roomTone') return `sfxFiles.${k} 文件不存在: ${v}`
    }
    for (const cat of ['trumpCatalog', 'itemCatalog']) {
      if (typeof body[cat] !== 'object' || body[cat] === null) return `${cat} 必须是对象`
      for (const [k, d] of Object.entries(body[cat])) {
        if (typeof d?.name !== 'string' || !d.name.trim()) return `${cat}.${k}.name 不能为空`
        if (typeof d?.summary !== 'string') return `${cat}.${k}.summary 必须是字符串`
        if (typeof d?.glyph !== 'string' || !d.glyph) return `${cat}.${k}.glyph 不能为空`
      }
    }
  }
  if (name === 'beats.json') {
    for (const sec of ['intro', 'restart', 't2', 't3']) {
      if (!Array.isArray(body[sec])) return `${sec} 必须是数组`
      for (const e of body[sec]) {
        if (typeof e.at !== 'number' || typeof e.lineEnd !== 'number') return `${sec} 条目 at/lineEnd 必须是数字`
        if (e.lineEnd <= e.at) return `${sec} 条目 lineEnd 必须大于 at`
        if (!['player', 'enemy', 'sister'].includes(e.channel)) return `${sec} channel 非法`
        if (typeof e.line !== 'string' || !e.line.trim()) return `${sec} 台词不能为空`
      }
    }
    const clues = body.clues
    if (typeof clues !== 'object' || clues === null) return 'clues 必须是对象'
    for (const key of ['level1', 'level3']) {
      if (!Array.isArray(clues[key]) || clues[key].length === 0) return `clues.${key} 必须是非空数组`
      for (const e of clues[key]) {
        if (typeof e.text !== 'string' || !e.text.trim()) return `clues.${key} 台词不能为空`
        if (!Number.isFinite(e.durationMs) || e.durationMs < 300) return `clues.${key} 显示时长至少 300ms`
        if (!['player', 'enemy', 'sister'].includes(e.channel)) return `clues.${key} channel 非法`
      }
    }
  }
  if (name === 'cutscenes.json') {
    for (const grp of ['cutscenes', 'endings']) {
      if (typeof body[grp] !== 'object' || body[grp] === null) return `${grp} 必须是对象`
      for (const [id, spec] of Object.entries(body[grp])) {
        if (typeof spec.duration !== 'number' || spec.duration <= 0) return `${grp}.${id}.duration 必须为正`
        for (const l of spec.lines ?? []) {
          if (typeof l.text !== 'string' || !l.text.trim()) return `${grp}.${id} 台词不能为空`
          if (l.end <= l.at) return `${grp}.${id} 条目 end 必须大于 at`
          if (!['player', 'enemy', 'sister'].includes(l.channel)) return `${grp}.${id} channel 非法`
        }
        for (const c of spec.cues ?? []) {
          if (typeof c.at !== 'number') return `${grp}.${id} cue.at 必须是数字`
        }
        if (grp === 'endings' && typeof spec.skippable !== 'boolean') return `endings.${id}.skippable 必须是布尔`
      }
    }
  }
  return null
}

http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/api/publish' && req.method === 'POST') {
    runBuild().then((r) => {
      res.writeHead(r.ok ? 200 : 500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(r.ok ? { ok: true } : { ok: false, error: '重建失败', log: r.out }))
    })
    return
  }
  if (p === '/api/data' && req.method === 'GET') {
    const out = {}
    for (const f of DATA_FILES) out[f] = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'))
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(JSON.stringify(out))
    return
  }
  if (p === '/api/data' && req.method === 'POST') {
    let raw = ''
    req.on('data', (c) => { raw += c; if (raw.length > 2_000_000) req.destroy() })
    req.on('end', () => {
      try {
        const { file, data } = JSON.parse(raw)
        const err = validatePayload(file, data)
        if (err) { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: err })); return }
        const target = path.join(dataDir, file)
        const bak = backupFile(target)
        fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n', 'utf8')
        // 保存即重建：4180 是 vite preview(dist)，不重建改了也不生效
        runBuild().then((r) => {
          res.writeHead(r.ok ? 200 : 500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(r.ok
            ? { ok: true, backup: path.relative(root, bak), built: true }
            : { ok: true, backup: path.relative(root, bak), built: false, buildError: r.out }))
        })
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: String(e?.message ?? e) }))
      }
    })
    return
  }
  if (p.startsWith('/api/audio-list') && req.method === 'GET') {
    const dir = path.join(root, 'public', 'audio')
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(ogg|wav|mp3)$/i.test(f)) : []
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ files }))
    return
  }
  if (p.startsWith('/api/models') && req.method === 'GET') {
    const dir = path.join(root, 'public', 'models')
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(glb|gltf)$/i.test(f)) : []
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ files }))
    return
  }
  if (p === '/api/upload' && req.method === 'POST') {
    const url = new URL(req.url, 'http://x')
    const target = url.searchParams.get('target') ?? ''
    const buf = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size > 60_000_000) req.destroy(); buf.push(c) })
    req.on('end', () => {
      const body = Buffer.concat(buf)
      let dest
      if (target.startsWith('models/')) {
        if (!/\.glb$/.test(target) || !body.subarray(0, 4).toString('binary').startsWith('glTF')) {
          res.writeHead(400); res.end('必须是 .glb 文件（glTF magic 校验失败）'); return
        }
        dest = path.join(root, 'public', target)
      } else if (target.startsWith('audio/')) {
        if (!/\.(ogg|wav|mp3)$/.test(target)) { res.writeHead(400); res.end('必须是 ogg/wav/mp3'); return }
        dest = path.join(root, 'public', target)
      } else { res.writeHead(400); res.end('非法目标'); return }
      if (!dest.startsWith(path.join(root, 'public'))) { res.writeHead(403); res.end('forbidden'); return }
      fs.mkdirSync(backupDir, { recursive: true })
      if (fs.existsSync(dest)) {
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
        fs.copyFileSync(dest, path.join(backupDir, `${stamp}-${path.basename(dest)}`))
      }
      fs.writeFileSync(dest, body)
      runBuild().then((r) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(r.ok ? { ok: true, built: true } : { ok: true, built: false, buildError: r.out }))
      })
    })
    return
  }
  const f = path.resolve(root, p === '/' ? 'editor/index.html' : '.' + p)
  if (!f.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return }
  fs.stat(f, (err, st) => {
    if (err || st.isDirectory()) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'content-type': mime[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache', 'content-length': st.size })
    fs.createReadStream(f).pipe(res)
  })
}).listen(4798, '0.0.0.0', () => console.log('editor on http://127.0.0.1:4798/ (game dev server runs separately)'))
