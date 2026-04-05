import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const PORT = 4310;
const ADMIN_ROOT = 'E:/blog/admin-local';
const BLOG_ROOT = 'E:/blog';
const POSTS_DIR = path.join(BLOG_ROOT, 'source', '_posts');
const ABOUT_FILE = path.join(BLOG_ROOT, 'source', 'about', 'index.md');

function send(res, code, data, type='application/json; charset=utf-8'){
  res.writeHead(code, { 'Content-Type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function readBody(req){
  return new Promise(resolve=>{ let buf=''; req.on('data',c=>buf+=c); req.on('end',()=>resolve(buf)); });
}
function slugify(s='post'){
  return s.toLowerCase().trim().replace(/[^a-z0-9\u4e00-\u9fa5]+/g,'-').replace(/^-+|-+$/g,'') || 'post';
}
function nowStr(){
  const d = new Date();
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function run(cmd, cwd=BLOG_ROOT){
  return new Promise(resolve=>{
    exec(cmd,{cwd},(error,stdout,stderr)=>{
      resolve({ ok: !error, output: [stdout,stderr,error?String(error):''].filter(Boolean).join('\n') });
    });
  });
}

const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);

  if(req.method==='GET' && (url.pathname==='/' || url.pathname==='/index.html')){
    const html = fs.readFileSync(path.join(ADMIN_ROOT,'public','index.html'),'utf8');
    return send(res,200,html,'text/html; charset=utf-8');
  }

  if(req.method==='GET' && url.pathname==='/api/posts'){
    const posts = fs.existsSync(POSTS_DIR) ? fs.readdirSync(POSTS_DIR).filter(f=>f.endsWith('.md')).sort().reverse() : [];
    return send(res,200,{posts});
  }

  if(req.method==='POST' && url.pathname==='/api/posts'){
    const raw = await readBody(req); const data = JSON.parse(raw||'{}');
    if(!data.title) return send(res,400,{message:'缺少标题'});
    const file = path.join(POSTS_DIR, `${slugify(data.title)}.md`);
    const tags = (data.tags||'').split(',').map(s=>s.trim()).filter(Boolean);
    const categories = (data.categories||'').split(',').map(s=>s.trim()).filter(Boolean);
    const content = `---\ntitle: ${data.title}\ndate: ${data.date || nowStr()}\n${tags.length?`tags:\n${tags.map(t=>`  - ${t}`).join('\n')}\n`:''}${categories.length?`categories:\n${categories.map(c=>`  - ${c}`).join('\n')}\n`:''}---\n\n${data.body||''}\n`;
    fs.writeFileSync(file, content, 'utf8');
    return send(res,200,{message:`已保存：${path.basename(file)}`});
  }

  if(req.method==='GET' && url.pathname==='/api/about'){
    const body = fs.existsSync(ABOUT_FILE) ? fs.readFileSync(ABOUT_FILE,'utf8') : '';
    return send(res,200,{body});
  }

  if(req.method==='POST' && url.pathname==='/api/about'){
    const raw = await readBody(req); const data = JSON.parse(raw||'{}');
    fs.writeFileSync(ABOUT_FILE, data.body || '', 'utf8');
    return send(res,200,{message:'关于页已保存'});
  }

  if(req.method==='POST' && url.pathname==='/api/action'){
    const raw = await readBody(req); const data = JSON.parse(raw||'{}');
    if(data.action==='build') return send(res,200, await run('npx hexo generate'));
    if(data.action==='git-status') return send(res,200, await run('git status --short'));
    if(data.action==='git-push'){
      const cmd = 'git add . && git commit -m "update from local admin" || exit 0';
      const a = await run(cmd);
      const b = await run('git push');
      return send(res,200,{output:[a.output,b.output].join('\n\n')});
    }
    return send(res,400,{message:'未知操作'});
  }

  send(res,404,{message:'Not found'});
});

server.listen(PORT, ()=>{
  console.log(`Blog admin local running: http://localhost:${PORT}`);
});
