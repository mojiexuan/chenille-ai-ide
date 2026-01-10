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

| Chenille AI IDE | Code -OSS 版本                                               | 日期                      |
| --------------- | ------------------------------------------------------------ | ------------------------- |
| v0.0.0          | [v1.107.1](https://github.com/microsoft/vscode/tree/1.107.1) | 2025 年 12 月 17 日 21:53 |

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

> 推荐使用 GitHub Actions 构建

### 安装依赖

```bash
npm install
```

### 构建命令

根据目标平台运行对应的 gulp 任务：

**Windows:**

若你的 Windows SDK 安装在非默认目录，你可能需要临时设置环境变量

```bash
$env:WindowsSdkDir = "E:\Windows Kits\10\"
$env:WindowsSDKVersion = "10.0.22621.0\"
```

#### 应用补丁

```bash
npx patch-package
```

> 提示：若打包时仍从默认目录查找 SDK，你可将 `node_modules\@vscode\gulp-electron\src\win32.js`中的 `let windowsSDKDir= "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\";
`修改为真实的值

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

### 生成安装包

#### Windows (.exe)

```bash
# 1. 先生成 inno_updater（自动更新组件）
npm run gulp vscode-win32-x64-inno-updater

# 2. 生成安装包
npm run gulp vscode-win32-x64-user-setup    # 用户版（安装到用户目录，无需管理员权限）
npm run gulp vscode-win32-x64-system-setup  # 系统版（安装到 Program Files，需管理员权限）
```

输出位置：`.build/win32-x64/user-setup/` 或 `system-setup/`

> ARM64 架构将 `x64` 替换为 `arm64` 即可

#### macOS (.app)

macOS 构建完成后直接生成 `.app` 应用包，无需额外打包步骤：

```bash
npm run gulp vscode-darwin-arm64-min    # Apple Silicon
npm run gulp vscode-darwin-x64-min      # Intel Mac
```

输出位置：`../VSCode-darwin-arm64/Chenille AI IDE.app` 或 `../VSCode-darwin-x64/`

用户可直接将 `.app` 拖入 Applications 文件夹使用，或手动压缩为 `.zip` / 制作 `.dmg` 分发。

> 注意：macOS 版本建议在 macOS 系统上构建，Windows 上构建需要管理员权限（符号链接）

#### Linux (.deb / .rpm)

```bash
# Debian/Ubuntu (.deb)
npm run gulp vscode-linux-x64-build-deb
npm run gulp vscode-linux-arm64-build-deb

# Red Hat/Fedora (.rpm)
npm run gulp vscode-linux-x64-build-rpm
npm run gulp vscode-linux-arm64-build-rpm
```

输出位置：`.build/linux-deb-*/` 或 `.build/linux-rpm-*/`

## 生产调试

在安装根目录执行启动命令加上 `--open-devtools` 参数

例如：

```bash
.\Chenille.exe --open-devtools
```

## License

### Microsoft 部分

Copyright (c) Microsoft Corporation. All rights reserved.

Licensed under the [MIT](https://github.com/microsoft/vscode/blob/main/LICENSE.txt) license.

### Chenille 部分

Copyright (c) Chenille. All rights reserved.

Licensed under the [MIT](/LICENSE.md) License.
