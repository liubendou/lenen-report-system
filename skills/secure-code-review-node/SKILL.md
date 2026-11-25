---
name: secure-code-review-node
description: 乐恩报道管理系统专用的代码审查 skill。适配纯 Node 零依赖后端 + 原生 JS 前端。来源：thechandanbhagat/claude-skills 的 code-review SKILL.md 骨架 + OWASP/Node.js 后端安全清单（对象/功能/属性授权、会话、限流、错误泄露），按本项目技术栈裁剪。Use when reviewing this repo before deployment.
---

# 乐恩系统 · 安全代码审查 Skill（v1 · 2026-11-01）

适配约定：零 npm 依赖（node:http + node:sqlite）、vanilla JS 前端、Cookie 会话、中文报错、内网部署（纯 HTTP，无 Secure flag）。

## A. 后端安全（server.js / lib/*）

| # | 检查项 | 本项目核查方法 |
|---|---|---|
| A1 | SQL 注入 | 全部语句必须 `?` 参数化；grep 拼接 `'...'+`/模板串进 SQL（白名单内的 LIMIT/列名除外） |
| A2 | 路径穿越 | 静态文件必须 normalize+前缀校验；grep `path.join` 后无校验的 |
| A3 | 命令注入/危险函数 | grep `eval|exec|spawn|child_process`；只允许 deploy/setup-tasks.js 固定参数 execFileSync |
| A4 | 对象授权（IDOR） | 每个按 id 操作学生的路由必须过 `assertStudentInScope`（含间接对象：请假单、成绩、宿舍分配） |
| A5 | 功能授权 | 每个路由有 perm 且 perm 在 PERM_KEYS；岗位 scope{all|classes} 真正生效 |
| A6 | 属性授权 | body 字段白名单式取用，不允许整包 spread 入库 |
| A7 | 认证 | scrypt+盐+timingSafeEqual；登录失败按 用户名|IP 锁定；未知用户做耗时对齐（防枚举） |
| A8 | 会话 | sid=crypto.randomBytes≥24；HttpOnly+SameSite；过期清理（启动+定时）；停用/重置后旧会话即时失效 |
| A9 | CSRF/Origin | 写请求 Origin 必须**严格相等**比对 Host（URL 解析后比 host，防子串绕过）；无 Origin 的工具调用放行 |
| A10 | 限流 | 登录锁定、注册按 IP 限次；防垃圾注册 |
| A11 | 输入校验 | 身份证 GB 校验码、手机号、金额钳位、日期格式；**先校验后写库** |
| A12 | 错误泄露 | 500 对外一律通用文案（详情只进 console）；不回堆栈/SQL/路径 |
| A13 | 响应头 | nosniff、X-Frame-Options、Referrer-Policy 全局；入口页 CSP；API 响应 no-store |
| A14 | 加密与随机 | 会话/重置密码用 crypto 随机，禁 Math.random 做凭据 |
| A15 | 敏感信息 | 密码字段不进审计/日志/导出；身份证列表脱敏 |
| A16 | 安全头 vs 真实访问路径 | 加 XFO/frame-ancestors/CSP 前必须确认有无 iframe 隧道/预览访问（v1.3.5 手机整页白屏事故）；改后必须经真实路径验证 |
| A17 | 头与限流的伪造面 | 登录锁定/限流不要信任 X-Forwarded-For（可轮换伪造绕过）；直接用 socket 地址 |
| A18 | 多写一致性 | 一个动作写多张表必须包事务（调换/退押金/自动分配/导入/缴费/请假/报到）；备份必须定期做恢复演练（integrity_check+行数比对） |

## B. 前端安全（public/app.js）

| # | 检查项 | 核查方法 |
|---|---|---|
| B1 | XSS | 禁 innerHTML/insertAdjacentHTML；一律 createElement+createTextNode（el() helper） |
| B2 | 组件降级 | 关键链路（登录/改密）组件不可用时必须有原生 DOM 保底 |
| B3 | 竞态 | 搜索类请求带序号丢弃旧响应 |
| B4 | CSS 兼容 | 新 CSS 特性（color-mix 等）前一条必须写静态 rgba 回退（旧 Android WebView） |
| B5 | 无障碍降级 | 原生降级输入必须带 aria-label/required；触控目标 ≥24px（WCAG 2.5.8） |

## C. 质量与工程

- 无死代码（声明未用/永假分支）；文件小而专一；函数无深嵌套
- 测试：改动必须有回归（full/smoke/audit 三套），新行为必须有新断言
- 版本：VERSION、index ?v=、full.js 断言三处同步
- 变更后：本地三套全绿 → 服务器回归 → 切进程 → 生产 probe

## D. 报告格式（沿用开源 skill 的格式）

```
# Code Review Report
## Summary  — Files reviewed: X / Critical: X / Warnings: X / Suggestions: X
## Critical Issues — [File:Line] 描述
## Warnings / Suggestions / Positive Observations
```

## E. 工程面板（20 视角，v1.3.8 轮起纳入）

Clean Code（死代码/长度）、DRY（重复收拢，如 getStudentScoped）、Twelve-Factor（env 配置/stdout 日志/可弃性）、SRE 运维（health/备份/重启）、nodebestpractices（错误分类）、**Keep a Changelog（CHANGELOG.md 必须随版本更新）**、SemVer、README 检查表（**必须含恢复方法**）、容量估算、SQLite 最佳实践（**PRAGMA user_version schema 戳**）、REST 一致性、错误处理分类、测试覆盖、依赖供应链（零依赖/钉版本）、时区正确性（后端 today + 前端 fmtDT 同一时区）、迁移管理、日志规范、可读性、3-2-1 备份、Excel/文件输入兼容（科学计数法归一）。

## U. UI 面板（Nielsen 十条启发式逐条过）

1 系统状态可见（loadbar/toast/处理中提示）｜2 贴近真实世界（中文业务用语）｜3 用户控制自由（危险双确认/可取消/可收起）｜4 一致性（按钮层级/措辞）｜5 错误预防（**日期/格式前端前置校验，不等后端 400**）｜6 识别而非回忆（**选人后必须回显姓名**、删除按钮可访问名）｜7 灵活效率（autofocus/回车提交/防抖）｜8 美学极简｜9 错误恢复（报错带建议动作）｜10 帮助文档（每页一句说明）。

判定标准：Critical=可被利用或造成资损/越权，必须当轮修；Warning=有证据的缺陷但利用条件苛刻，排期修；Suggestion=改进项。
