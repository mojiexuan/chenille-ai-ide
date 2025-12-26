# Chenille - AI IDE - 毛毛虫 🐛

<p align="center">
  <strong>一个完全开源、自由可控的 AI 编程助手</strong>
</p>

<p align="center">
  基于 VS Code 二次开发 · 隐私优先 · 不联网 · 自由定制
</p>

---

## ✨ 特性

- 🔓 **完全开源** - 代码透明，社区驱动，无商业绑定
- 🔌 **自由接入** - 支持自定义 BaseURL，不强绑定任何服务商，你的 AI 你做主
- 📝 **自定义提示词** - 完全掌控 System Prompt，打造专属编程助手
- 🔒 **隐私保护** - 代码不上传云端，数据留在本地，安全可控
- 🌐 **离线可用** - 搭配本地模型，无需联网即可使用
- 🎨 **自由定制** - 继承 VS Code 生态，插件、主题全兼容

## 🎯 为什么选择 Chenille？

| 痛点                       | Chenille 的解决方案      |
| -------------------------- | ------------------------ |
| 商业 AI IDE 强绑定特定服务 | 自由选择任意 AI 后端     |
| 代码上传云端，隐私风险     | 本地处理，数据不出门     |
| 提示词不可控，效果难优化   | 完全自定义 System Prompt |
| 闭源黑盒，无法审计         | 100% 开源，代码可审计    |

---

## 版本追踪

| Chenille AI IDE | Code -OSS 版本 | 日期                      |
| --------------- | -------------- | ------------------------- |
| v0.0.0          | v1.107.1       | 2025 年 12 月 17 日 21:53 |

## 开发

### 环境

> Python = 3.13

> Node = 22.20.0

> C++ >= 17
>
> 安装组件
> -> MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs
> -> '使用 C++的桌面开发'
>
> 注意若控制台`cl`命令报错，则需要将`E:\你的 Visual Studio 安装目录\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64`添加进`PATH`环境变量中
>
> 可临时设置安装目录 `$env:vs2022_install="E:\Microsoft Visual Studio\2022\Community"`，注意替换成你真实的安装目录

> git

### 依赖

#### 安装 `electron`

直接去下载包

[electron-v39.2.3-win32-x64.zip](https://github.com/electron/electron/releases)

下载后将压缩包放进

`C:\Users\<你>\AppData\Local\electron\Cache\
`

#### 设置临时环境变量

```bash
$Env:ELECTRON_SKIP_BINARY_DOWNLOAD="1"
```

```bash
$Env:ELECTRON_CACHE="$Env:LOCALAPPDATA\electron"
```

### 仓库

需要先初始化`git`仓库， Chenille 的 postinstall 脚本需要在 Git 仓库中运行。

```bash
git init
git add .
git commit -m "Initial commit"
```

#### 安装依赖

正式安装依赖，需要 **梯子**

```bash
npm install
```

#### 关于镜像源

##### 查看镜像源

```bash
npm get registry
```

##### 设置镜像源

```bash
npm config set registry https://registry.npmmirror.com/
```

### 启动

> 需要启动两个终端

#### 终端-1

持续监听文件变化并自动重新编译

```bash
npm run watch
```

出现 `Finished compilation with 0 errors after xx ms` 则编译成功。

#### 终端-2

启动开发版本

> 注意：可能仍然需要设置刚才的临时变量，若下载仍然失败，你可直接将 `electron` 的压缩包解压到 `.build` 目录下，目录名为 `electron`
>
> ！！注意：若自行解压，需要将 `electron.exe` 重命名为 `Chenille.exe`

```bash
.\scripts\code.bat
```

## 调试

快捷键 `Ctrl` + `Shift` + `I`

## 构建

### 安装依赖

```bash
npm install
```

### 构建命令

根据目标平台运行对应的 gulp 任务：

**Windows:**

```bash
npm run gulp vscode-win32-x64-min      # x64 架构
npm run gulp vscode-win32-arm64-min    # ARM64 架构
```

**macOS:**

```bash
npm run gulp vscode-darwin-x64-min     # Intel Mac
npm run gulp vscode-darwin-arm64-min   # Apple Silicon
```

**Linux:**

```bash
npm run gulp vscode-linux-x64-min      # x64
npm run gulp vscode-linux-arm64-min    # ARM64
npm run gulp vscode-linux-armhf-min    # ARM 32位
```

### 输出位置

构建产物输出到项目根目录的上一级目录，例如：

- `../VSCode-win32-x64/`
- `../VSCode-darwin-arm64/`

### 开发构建（不压缩）

不带 `-min` 后缀的版本不进行代码压缩混淆，适合开发调试：

```bash
npm run gulp vscode-win32-x64    # Windows 开发版
```

## License

Copyright (c) Microsoft Corporation. All rights reserved.

Licensed under the [MIT](LICENSE.txt) license.
