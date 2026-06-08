# QQ Sticker Viewer

在线预览和批量下载QQ表情包，支持动图(GIF)/静图(PNG)检测，一键打包下载。

## 项目结构

```
├── index.html              # 前端页面
├── style.css               # 样式
├── app.js                  # 前端逻辑
├── functions/
│   └── api/
│       ├── sticker.js      # API: 获取表情包元数据
│       └── proxy.js        # API: 图片代理 (解决CORS)
├── _headers                # CF Pages 自定义响应头
├── _redirects              # CF Pages 路由
├── package.json
└── README.md
```

## 功能

- 🔗 粘贴QQ表情商城链接或输入表情包ID，即可预览
- 🎭 自动检测动图(GIF)和静图(PNG)
- ✅ 支持全选/多选
- 📦 批量打包下载（ZIP），可选GIF或PNG格式
- 🔗 生成分享链接，可直接分享给他人
- 📱 响应式设计，移动端友好

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sticker?id=241071` | GET | 获取表情包元数据（名称、图片列表等） |
| `/api/proxy?url=<encoded_url>` | GET/HEAD | 代理图片请求，仅允许白名单域名 |

## 部署到 Cloudflare Pages

### GitHub 直连（推荐）

1. 将此仓库推送到 GitHub
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
3. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
4. 选择此仓库
5. 构建设置：
   - **Framework preset**: `None`
   - **Build command**: 留空
   - **Build output directory**: `/`
6. 点击 **Save and Deploy**

> CF Pages 会自动识别 `functions/` 目录并部署为 serverless 函数。

### 本地开发（使用 wrangler）

```bash
npx wrangler pages dev .
```

这会同时启动静态文件服务和 Functions，完整模拟 CF Pages 环境。

## 使用方式

部署后访问：
```
https://your-site.pages.dev/?id=241071
```

### 支持的输入格式

- 纯数字 ID: `241071`
- QQ表情商城完整链接: `https://zb.vip.qq.com/hybrid/emoticonmall/detail?id=241071&...`

## 技术栈

- **前端**: 纯 HTML/CSS/JS（无框架）
- **后端**: Cloudflare Pages Functions（`functions/api/`）
- **打包下载**: JSZip + FileSaver.js（前端 CDN 引入）
- **数据源**: `i.gtimg.cn` CDN API，通过 Functions 代理
