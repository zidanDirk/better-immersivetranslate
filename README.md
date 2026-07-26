# 网页沉浸式翻译

一款使用自带 API Key（BYOK）的 Chrome 网页翻译扩展。它直接调用用户配置的 OpenAI 兼容服务，在保留原文的同时，将译文显示在对应内容附近。

## 功能

- 翻译当前网页，并保留标题、段落、列表和表格等内容结构
- 在双语对照、仅译文和仅原文三种阅读方式之间切换
- 通过右键菜单翻译选中文本
- 为不同网站设置目标语言、翻译提示词和自动翻译
- 增量翻译页面中新出现或发生变化的内容
- 使用本地翻译缓存减少重复请求
- 自定义全局翻译提示词和术语表
- 配置多个 OpenAI 兼容服务，包括模型、请求参数和自定义请求头

## 安装

当前版本需要以开发者模式加载：

```bash
git clone https://github.com/zidanDirk/better-immersivetranslate.git
cd better-immersivetranslate
npm install
npm run build
```

随后在 Chrome 中完成以下操作：

1. 打开 `chrome://extensions`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目中的 `dist` 目录。

## 配置

在 Chrome 扩展管理页打开本扩展的“扩展程序选项”，新增一个 LLM 配置：

- **服务地址**：OpenAI 兼容接口的基础地址，例如 `https://api.example.com/v1`
- **API Key**：对应服务的密钥
- **模型**：用于翻译的模型名称
- **请求参数**：可选的 JSON 参数
- **自定义请求头**：可选的 JSON 请求头

保存前可使用“测试连接”检查配置。目标服务必须支持 OpenAI Chat Completions 接口，并允许浏览器扩展发起跨域请求。

## 使用

- 点击扩展图标，再点击“翻译当前网页”。
- 在弹窗中切换双语对照、仅译文或仅原文。
- 选中网页文字后，右键点击“翻译选中文本”。
- 在“网站覆盖设置”中为当前网站指定目标语言、提示词或开启自动翻译。开启自动翻译时，扩展才会请求该网站的访问权限。

输入框、文本编辑器、密码字段、代码块、命令行、日志、普通 iframe、Chrome 内置页面和本地文件页面不会被翻译。

## 隐私与安全

扩展采用浏览器直连的 BYOK 架构：

- API Key、LLM 配置、翻译偏好、术语表和翻译缓存保存在 Chrome 本地存储中。
- 翻译请求从浏览器直接发送到用户配置的 LLM 服务，不经过项目运营方的中转服务器。
- 扩展默认仅在用户主动操作时访问当前页面；网站自动翻译权限按网站单独申请。

浏览器扩展环境无法绝对隐藏 API Key，请只在可信设备上使用，并自行确认所选 LLM 服务的隐私政策和计费规则。

## 开发

```bash
# 构建扩展并执行类型检查
npm run build

# 仅执行类型检查
npm run typecheck

# 构建并运行端到端测试
npm test
```

端到端测试使用 Playwright 和 Chromium。首次运行前如本机尚未安装对应浏览器，可执行：

```bash
npx playwright install chromium
```

项目的产品规格与架构决策见：

- [网页沉浸式翻译插件规格](docs/spec-web-bilingual-translation.md)
- [浏览器直连的 BYOK 架构](docs/adr/0001-browser-direct-byok.md)
