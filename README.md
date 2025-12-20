# Chenille - Chenille - 毛毛虫

> Code - OSS v1.107.1

## 环境

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

## 依赖

### 安装 `electron`

直接去下载包

[electron-v39.2.3-win32-x64.zip](https://github.com/electron/electron/releases)

下载后将压缩包放进

`C:\Users\<你>\AppData\Local\electron\Cache\
`

### 设置临时环境变量

```bash
$Env:ELECTRON_SKIP_BINARY_DOWNLOAD="1"
```

```bash
$Env:ELECTRON_CACHE="$Env:LOCALAPPDATA\electron"
```

## 仓库

需要先初始化`git`仓库， Chenille 的 postinstall 脚本需要在 Git 仓库中运行。

```bash
git init
git add .
git commit -m "Initial commit"
```

### 安装依赖

正式安装依赖，需要 **梯子**

```bash
npm install
```

### 关于镜像源

#### 查看镜像源

```bash
npm get registry
```

#### 设置镜像源

```bash
npm config set registry https://registry.npmmirror.com/
```

## 开发

> 需要启动两个终端

### 终端-1

持续监听文件变化并自动重新编译

```bash
npm run watch
```

出现 `Finished compilation with 0 errors after xx ms` 则编译成功。

### 终端-2

启动开发版本

> 注意：可能仍然需要设置刚才的临时变量，若下载仍然失败，你可直接将 `electron` 的压缩包解压到 `.build` 目录下，目录名为 `electron`
>
> ！！注意：若自行解压，需要将 `electron.exe` 重命名为 `Chenille.exe`

```bash
.\scripts\code.bat
```

## 构建

## License

Copyright (c) Microsoft Corporation. All rights reserved.

Licensed under the [MIT](LICENSE.txt) license.
