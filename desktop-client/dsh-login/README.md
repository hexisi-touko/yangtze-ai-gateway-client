# 无端口 Harness 的 New API 登录集成

登录资源来源：用户指定的 API-Client-LocalTest-Portable-1.0.0-x64 (2).exe，经 7za 提取 resources/app.asar。

服务：http://127.0.0.1:3000。保留原登录、两步验证、注册申请、找回密码、Windows safeStorage 记住凭据流程。

认证成功并验证 /api/user/self 的成员角色及账号 ID 后启动 Harness Host。按服务地址和账号 ID 的 SHA-256 在原 DSH_HOME/new-api-accounts 下隔离 Harness 用户数据。桌面运行时 profile 仍复用已安装依赖。退出登录停止 Host，清空认证 session 并返回登录页。

harness-main.base.mjs 是修复 Windows fs-ext 加载问题后的桌面入口基线。integrate.cjs 在 output/dsh-login-build/app 已解包目录上应用集成，原入口匹配失败会终止；打包前必须确认脚本退出码和语法检查通过。

验证：gate.test.cjs 的 5 项测试通过；实际 Electron 登录窗口显示成功；本地 /api/status 返回 success=true。尚未验证真实成员凭据的 GUI 登录、注册提交、找回密码、2FA 和模型请求。

桌面包备份：resources/app.asar.before-login-20260909。

此改动未实现 New API 模型配置自动映射，也未改变 Harness 模型设置页。
