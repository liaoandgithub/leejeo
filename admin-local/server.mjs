import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
import crypto from 'node:crypto';

const PORT = 4310;
const ADMIN_ROOT = 'E:/blog/admin-local';
const BLOG_ROOT = 'E:/blog';
const POSTS_DIR = path.join(BLOG_ROOT, 'source', '_posts');
const DRAFTS_DIR = path.join(BLOG_ROOT, 'source', '_drafts');
const ABOUT_FILE = path.join(BLOG_ROOT, 'source', 'about', 'index.md');
const CONFIG_FILE = path.join(BLOG_ROOT, '_config.yml');
const FLUID_CONFIG_FILE = path.join(BLOG_ROOT, '_config.fluid.yml');
const UPLOAD_DIR = path.join(BLOG_ROOT, 'source', 'images', 'uploads');
const ADMIN_PASSWORD = 'Liao2010';
const sessions = new Set();
const HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000;
let lastHeartbeatAt = Date.now();

function send(res, code, data, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function readBody(req) {
  return new Promise(resolve => {
    let buf = '';
    req.on('data', c => (buf += c));
    req.on('end', () => resolve(buf));
  });
}
function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) {
  const cookies = parseCookies(req);
  return !!(cookies.admin_session && sessions.has(cookies.admin_session));
}
function requireAuth(req, res) {
  if (!isAuthed(req)) {
    send(res, 401, { message: '未登录' });
    return false;
  }
  return true;
}
function slugify(s = 'post') {
  return s.toLowerCase().trim().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'post';
}
function nowStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function run(cmd, cwd = BLOG_ROOT) {
  return new Promise(resolve => {
    exec(cmd, { cwd, shell: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: [stdout, stderr, error ? String(error) : ''].filter(Boolean).join('\n') });
    });
  });
}
function parseFrontmatter(content = '') {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { attrs: {}, body: content };
  const raw = m[1], body = m[2], attrs = {};
  let currentKey = '';
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s+-\s+/.test(line) && currentKey) {
      attrs[currentKey] = attrs[currentKey] || [];
      attrs[currentKey].push(line.replace(/^\s+-\s+/, ''));
      continue;
    }
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    currentKey = k;
    attrs[k] = v;
  }
  return { attrs, body };
}
function buildPostContent({ title, date, tags, categories, body }) {
  const t = (tags || '').split(',').map(s => s.trim()).filter(Boolean);
  const c = (categories || '').split(',').map(s => s.trim()).filter(Boolean);
  return `---\ntitle: ${title}\ndate: ${date || nowStr()}\n${t.length ? `tags:\n${t.map(x => `  - ${x}`).join('\n')}\n` : ''}${c.length ? `categories:\n${c.map(x => `  - ${x}`).join('\n')}\n` : ''}---\n\n${body || ''}\n`;
}
function parseMultipart(req, raw) {
  const type = req.headers['content-type'] || '';
  const match = type.match(/boundary=(.*)$/);
  if (!match) return null;
  const boundary = '--' + match[1];
  const parts = raw.split(boundary).filter(p => p.includes('Content-Disposition'));
  for (const p of parts) {
    const nameMatch = p.match(/name="([^"]+)"/);
    const fileMatch = p.match(/filename="([^"]*)"/);
    if (nameMatch?.[1] === 'image' && fileMatch) {
      const start = p.indexOf('\r\n\r\n');
      if (start < 0) continue;
      let content = p.slice(start + 4);
      content = content.replace(/\r\n--$/, '').replace(/\r\n$/, '');
      return { filename: fileMatch[1], content };
    }
  }
  return null;
}
function readSiteConfig() {
  const s = fs.readFileSync(CONFIG_FILE, 'utf8');
  return {
    title: (s.match(/^title:\s*(.*)$/m) || [])[1] || '',
    subtitle: (s.match(/^subtitle:\s*'(.*)'$/m) || s.match(/^subtitle:\s*(.*)$/m) || [])[1] || '',
    description: (s.match(/^description:\s*'(.*)'$/m) || s.match(/^description:\s*(.*)$/m) || [])[1] || '',
    url: (s.match(/^url:\s*(.*)$/m) || [])[1] || '',
    root: (s.match(/^root:\s*(.*)$/m) || [])[1] || ''
  };
}
function upsertYamlLine(s, key, value, afterKey = '') {
  const line = `${key}: ${value}`;
  const re = new RegExp(`^${key}:\\s*.*$`, 'm');
  if (re.test(s)) return s.replace(re, line);
  if (afterKey) return s.replace(new RegExp(`^${afterKey}:\\s*.*$`, 'm'), m => `${m}\n${line}`);
  return `${s.trimEnd()}\n${line}\n`;
}
function writeSiteConfig({ title = '', subtitle = '', description = '', url = '', root = '' }) {
  let s = fs.readFileSync(CONFIG_FILE, 'utf8');
  s = s.replace(/^title:\s*.*/m, `title: ${title}`);
  s = s.replace(/^subtitle:\s*.*/m, `subtitle: '${String(subtitle).replace(/'/g, "''")}'`);
  s = s.replace(/^description:\s*.*/m, `description: '${String(description).replace(/'/g, "''")}'`);
  s = upsertYamlLine(s, 'url', url || 'https://leejeoo.github.io/leeejeo');
  s = upsertYamlLine(s, 'root', root || '/leeejeo/', 'url');
  fs.writeFileSync(CONFIG_FILE, s, 'utf8');
}
function readFluidHomeInfo() {
  const s = fs.readFileSync(FLUID_CONFIG_FILE, 'utf8');
  return {
    blog_title: (s.match(/blog_title:\s*"([^"]*)"/) || [])[1] || '',
    slogan: (s.match(/text:\s*"([^"]*)"/) || [])[1] || '',
    about_name: (s.match(/name:\s*"([^"]*)"/) || [])[1] || '',
    about_intro: (s.match(/intro:\s*"([^"]*)"/) || [])[1] || '',
    banner_img: ((s.match(/banner_img:\s*(.*)$/m) || [])[1] || '').trim()
  };
}
function writeFluidHomeInfo({ blog_title = '', slogan = '', about_name = '', about_intro = '', banner_img = '' }) {
  let s = fs.readFileSync(FLUID_CONFIG_FILE, 'utf8');
  s = s.replace(/blog_title:\s*"([^"]*)"/, `blog_title: "${String(blog_title).replace(/"/g, '\\"')}"`);
  s = s.replace(/text:\s*"([^"]*)"/, `text: "${String(slogan).replace(/"/g, '\\"')}"`);
  s = s.replace(/name:\s*"([^"]*)"/, `name: "${String(about_name).replace(/"/g, '\\"')}"`);
  s = s.replace(/intro:\s*"([^"]*)"/, `intro: "${String(about_intro).replace(/"/g, '\\"')}"`);
  s = s.replace(/banner_img:\s*.*$/m, `banner_img: ${banner_img || '/img/default.png'}`);
  fs.writeFileSync(FLUID_CONFIG_FILE, s, 'utf8');
}
function ensureHexoServer() {
  return new Promise(resolve => {
    exec('netstat -ano | findstr :4000', { shell: true }, (error, stdout) => {
      if (!error && stdout && stdout.trim()) {
        return resolve({ ok: true, output: 'Hexo 预览服务已在 4000 端口运行。' });
      }
      const child = spawn('npx', ['hexo', 'server'], { cwd: BLOG_ROOT, shell: true, detached: true, stdio: 'ignore' });
      child.unref();
      setTimeout(() => resolve({ ok: true, output: '已尝试启动 Hexo 预览服务，请稍后打开预览链接。' }), 1500);
    });
  });
}
function readPostsWithMeta(dir, status) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().reverse().map(file => {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const parsed = parseFrontmatter(raw);
    return {
      file,
      status,
      title: parsed.attrs.title || file,
      date: parsed.attrs.date || '',
      tags: Array.isArray(parsed.attrs.tags) ? parsed.attrs.tags : [],
      categories: Array.isArray(parsed.attrs.categories) ? parsed.attrs.categories : [],
      excerpt: (parsed.body || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    };
  });
}
function collectSuggestions(posts) {
  const tags = new Set();
  const categories = new Set();
  posts.forEach(p => { (p.tags || []).forEach(t => tags.add(t)); (p.categories || []).forEach(c => categories.add(c)); });
  return { tags: Array.from(tags), categories: Array.from(categories) };
}
function loginPage() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>后台解锁</title><style>body{font-family:system-ui,sans-serif;background:#f5f7fb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0} .box{background:#fff;padding:28px;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.08);width:320px} input{width:100%;padding:10px 12px;margin:10px 0 14px;border:1px solid #d1d5db;border-radius:10px;box-sizing:border-box} button{width:100%;padding:10px 12px;border:none;border-radius:10px;background:#2563eb;color:#fff;cursor:pointer} .msg{color:#b91c1c;font-size:14px;min-height:20px}</style></head><body><div class="box"><h2>后台解锁</h2><p>请输入密码进入博客管理台。</p><input id="pwd" type="password" placeholder="输入密码"><button onclick="login()">解锁</button><div class="msg" id="msg"></div></div><script>async function login(){const res=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pwd').value})}); if(res.ok){location.href='/';} else {const d=await res.json(); document.getElementById('msg').textContent=d.message||'密码错误';}}</script></body></html>`;
}

setInterval(() => {
  if (Date.now() - lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
    console.log('No heartbeat for 2 minutes, shutting down blog admin local.');
    process.exit(0);
  }
}, 15000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/login') {
    return send(res, 200, loginPage(), 'text/html; charset=utf-8');
  }
  if (req.method === 'POST' && url.pathname === '/login') {
    const data = JSON.parse((await readBody(req)) || '{}');
    if (data.password !== ADMIN_PASSWORD) return send(res, 401, { message: '密码错误' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.add(token);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax` });
    return res.end(JSON.stringify({ message: '登录成功' }));
  }
  if (req.method === 'POST' && url.pathname === '/logout') {
    const cookies = parseCookies(req);
    if (cookies.admin_session) sessions.delete(cookies.admin_session);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
    return res.end(JSON.stringify({ message: '已退出' }));
  }

  if (req.method === 'POST' && url.pathname === '/heartbeat') {
    lastHeartbeatAt = Date.now();
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    if (!isAuthed(req)) {
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }
    return send(res, 200, fs.readFileSync(path.join(ADMIN_ROOT, 'public', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
  }

  if (url.pathname.startsWith('/api/') && !requireAuth(req, res)) return;

  if (req.method === 'GET' && url.pathname === '/api/posts') {
    const posts = [...readPostsWithMeta(POSTS_DIR, 'publish'), ...readPostsWithMeta(DRAFTS_DIR, 'draft')];
    return send(res, 200, { posts, suggestions: collectSuggestions(posts) });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/posts/')) {
    const file = decodeURIComponent(url.pathname.replace('/api/posts/', ''));
    const status = url.searchParams.get('status') || 'publish';
    const baseDir = status === 'draft' ? DRAFTS_DIR : POSTS_DIR;
    const p = path.join(baseDir, file);
    if (!fs.existsSync(p)) return send(res, 404, { message: '文件不存在' });
    const parsed = parseFrontmatter(fs.readFileSync(p, 'utf8'));
    return send(res, 200, { title: parsed.attrs.title || '', date: parsed.attrs.date || '', tags: Array.isArray(parsed.attrs.tags) ? parsed.attrs.tags : [], categories: Array.isArray(parsed.attrs.categories) ? parsed.attrs.categories : [], body: parsed.body || '' });
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/posts/')) {
    const file = decodeURIComponent(url.pathname.replace('/api/posts/', ''));
    const status = url.searchParams.get('status') || 'publish';
    const baseDir = status === 'draft' ? DRAFTS_DIR : POSTS_DIR;
    const p = path.join(baseDir, file);
    if (!fs.existsSync(p)) return send(res, 404, { message: '文件不存在' });
    fs.unlinkSync(p); return send(res, 200, { message: '已删除：' + file });
  }
  if (req.method === 'POST' && url.pathname === '/api/posts') {
    const data = JSON.parse((await readBody(req)) || '{}');
    if (!data.title) return send(res, 400, { message: '缺少标题' });
    const baseDir = data.status === 'draft' ? DRAFTS_DIR : POSTS_DIR;
    fs.mkdirSync(baseDir, { recursive: true });
    const file = data.file ? path.join(baseDir, data.file) : path.join(baseDir, `${slugify(data.title)}.md`);
    fs.writeFileSync(file, buildPostContent(data), 'utf8'); return send(res, 200, { message: `已保存：${path.basename(file)}` });
  }
  if (req.method === 'GET' && url.pathname === '/api/about') {
    const raw = fs.existsSync(ABOUT_FILE) ? fs.readFileSync(ABOUT_FILE, 'utf8') : '';
    const parsed = parseFrontmatter(raw);
    return send(res, 200, { title: parsed.attrs.title || '', body: parsed.body || '' });
  }
  if (req.method === 'POST' && url.pathname === '/api/about') {
    const data = JSON.parse((await readBody(req)) || '{}');
    const content = `---\ntitle: ${data.title || '关于'}\nlayout: about\n---\n\n${data.body || ''}\n`;
    fs.writeFileSync(ABOUT_FILE, content, 'utf8'); return send(res, 200, { message: '关于页已保存' });
  }
  if (req.method === 'GET' && url.pathname === '/api/site-config') return send(res, 200, readSiteConfig());
  if (req.method === 'POST' && url.pathname === '/api/site-config') { const data = JSON.parse((await readBody(req)) || '{}'); writeSiteConfig(data); return send(res, 200, { message: '站点配置已保存' }); }
  if (req.method === 'GET' && url.pathname === '/api/home-info') return send(res, 200, readFluidHomeInfo());
  if (req.method === 'POST' && url.pathname === '/api/home-info') { const data = JSON.parse((await readBody(req)) || '{}'); writeFluidHomeInfo(data); return send(res, 200, { message: '首页信息已保存' }); }
  if (req.method === 'POST' && url.pathname === '/api/upload-image') {
    const raw = await readBody(req); const part = parseMultipart(req, raw); if (!part) return send(res, 400, { message: '上传失败' });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true }); const ext = path.extname(part.filename || '').toLowerCase() || '.png'; const name = `${Date.now()}${ext}`; fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(part.content, 'binary'));
    const publicPath = `/images/uploads/${name}`; return send(res, 200, { message: '上传成功', markdown: `![](${publicPath})` });
  }
  if (req.method === 'POST' && url.pathname === '/api/preview') return send(res, 200, await ensureHexoServer());
  if (req.method === 'POST' && url.pathname === '/api/action') {
    const data = JSON.parse((await readBody(req)) || '{}');
    if (data.action === 'build') return send(res, 200, await run('npx hexo generate'));
    if (data.action === 'git-status') return send(res, 200, await run('git status --short'));
    if (data.action === 'preview-start') return send(res, 200, await ensureHexoServer());
    if (data.action === 'preview-stop') return send(res, 200, await run("for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :4000 ^| findstr LISTENING') do taskkill /PID %a /F"));
    if (data.action === 'git-push') { const a = await run('git add . && git commit -m "update from local admin"'); const b = await run('git push'); return send(res, 200, { output: [a.output, b.output].join('\n\n') }); }
    return send(res, 400, { message: '未知操作' });
  }
  send(res, 404, { message: 'Not found' });
});

server.listen(PORT, () => console.log(`Blog admin local running: http://localhost:${PORT}`));
