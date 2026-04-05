# GitHub Pages 部署说明

已按以下信息配置：

- GitHub 用户名：`liaoandgithub`
- 仓库名：`leejeo`
- 站点地址：`https://liaoandgithub.github.io/leejeo`

## 1. 初始化 Git 仓库（如果还没有）

```bash
cd /d E:\blog
git init
git branch -M main
git add .
git commit -m "init blog"
```

## 2. 关联 GitHub 仓库

```bash
git remote add origin https://github.com/liaoandgithub/leejeo.git
```

如果已经有 origin：

```bash
git remote set-url origin https://github.com/liaoandgithub/leejeo.git
```

## 3. 推送代码

```bash
git push -u origin main
```

## 4. GitHub Pages 设置

进入 GitHub 仓库页面：
- Settings
- Pages
- Build and deployment
- Source 选择：`GitHub Actions`

然后等待 Actions 跑完。

## 5. 本地预览

```bash
cd /d E:\blog
npx hexo server
```

打开：
- http://localhost:4000

## 6. 新建文章

```bash
cd /d E:\blog
npx hexo new post "文章标题"
```

文章目录：
- `source/_posts/`

## 7. 你的最终站点地址

- https://liaoandgithub.github.io/leejeo
