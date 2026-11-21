<p align="center">
    <h1 align="center">Bark-Worker</h1>
</p>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**[English](README.md)** | 中文文档

<!-- > [!CAUTION]
> Cloudflare Dashboard 目前(2024-07-27)存在Bug, 部署和变量编辑不可用, 在Cloudflare修复该问题之前请勿进行任何操作, 如果需要部署请使用wrangler. -->

<!-- > [!NOTE]
> Device token可能发生变化, 之前使用多Key或Key别名的方法可能会失效, 如有多Key使用需要参考[Tips](doc/tips.zh.md). -->

> [!NOTE]
> 批量推送有最高优先级, 如果指定了`device_keys`且不为空, `device_key`将被忽略.



Bark-Worker 是一个 [Bark-Server](https://github.com/Finb/bark-server) 在 Cloudflare Worker 上的实现. 为隐私敏感的用户提供一个低成本且保证隐私的服务端.

### 什么是 [Bark](https://github.com/Finb/Bark)?
[Bark](https://github.com/Finb/Bark) 是一个允许向iPhone发送通知的iOS APP.

> [!NOTE]
> 如果worker.dev域名在当前国家/地区不可用，则需要一个自己的域名

## 特性
- 支持所有的Bark-Server API
    - `register`
    - `ping`
    - `healthz`
    - `info`
    - `push`
- 基于路径的参数解析
- 便于部署, 低成本且方便管理

## 部署

创建一个 Worker 和 KV namespace，将 namespace 以 `database` 为名称绑定至 Worker。

参考 [部署指南](doc/setup_guide.zh.md)。

## Tips

- 一个设备使用多个Key
- 设备Key别名
- etc.

参考 [Tips](doc/tips.zh.md)
