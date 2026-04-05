# Cloudflare Pages 部署说明

目标仓库：`liaoandgithub/leejeo`

## 在 Cloudflare Pages 中这样填写

### Connect to Git
- 选择 GitHub
- 连接仓库：`liaoandgithub/leejeo`

### Build settings
- Framework preset: `None`
- Build command: `npx hexo generate`
- Build output directory: `public`
- Root directory: `/`（默认即可）

### Environment Variables（如需要）
- `NODE_VERSION = 20`

## 部署后
Cloudflare 会给你一个 `*.pages.dev` 域名。

## 如果以后绑定自定义域名
在 Cloudflare Pages 项目里添加自定义域名即可。

## 本地测试
```bash
cd /d E:\blog
npx hexo server
```

## 本地构建
```bash
cd /d E:\blog
npx hexo generate
```
