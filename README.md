# 长大计科智慧油田实验室客户端

桌面客户端源码位于 `desktop-client/`。仓库根目录只放项目说明和仓库级配置；构建产物、解包应用、安装包及本机验证数据不纳入版本控制。

## 目录

- `desktop-client/dsh-login/`：登录界面、服务端 API、模型桥接、更新日志与桌面端定制逻辑。
- `desktop-client/src/`：Electron 主进程的任务管理和本地工具模块。
- `desktop-client/ui/`：工具切换器等独立界面资源。
- `desktop-client/scripts/`：图标与 Windows 发布构建脚本。
- `desktop-client/SERVER-CONTRACT.md`：客户端依赖的服务端接口约定。

## 本地开发

直接运行源码或使用通用 Electron 构建时，将 `desktop-client/desktop.config.example.json` 复制为 `desktop-client/desktop.config.json`，再填写自己的服务地址；真实配置由 Git 忽略，不要提交。安装依赖后，可运行 `npm run check` 检查源码语法。当前 Release 使用 `npm run build:current-client`，以本机已安装的 `1.0.0` 客户端和其中的部署配置为输入，生成 `1.0.1` Windows 安装包；构建结果写入被忽略的本地产物目录。
