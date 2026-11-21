<p align="center">
    <h1 align="center">Bark-Worker</h1>
</p>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

English | **[中文文档](README.zh.md)**

<!-- > [!CAUTION]
> There are bugs in Cloudflare Dashboard for now(2024-07-27), deploy and variables edit are not available, DONOT change anything before Cloudflare fix that. If you want to deploy, use wrangler. -->

<!-- > [!NOTE]
> Device token may change, the previous way to use multi-key or key alias may be unavailable, refer to [Tips](doc/tips.md) for more details. -->

> [!NOTE]
> Batch Push has the highest priority, if `device_keys` is specified and not empty, `device_key` will be ignored, in both V1 and V2 APIs.



Bark-Worker is a [Bark-Server](https://github.com/Finb/bark-server) implenmention on Cloudflare Worker. It provides privacy-aware users with a cheap and private bark backend. 

### What is [Bark](https://github.com/Finb/Bark)?
[Bark](https://github.com/Finb/Bark) is an iOS App which allows you to push customed notifications to your iPhone.

> [!NOTE]
> A domain is required if worker.dev is unavailable in your country/region

## Features
- Full Bark-Server APIs support
    - `register`
    - `ping`
    - `healthz`
    - `info`
    - `push`
- Path based parameters resolve
- Easy to deploy, Cheap to use and Convenient to manage

## Setup

Create a Worker and a KV namespace, and bind the namespace to the Worker as `database`.

Refer to the [Setup Guide](doc/setup_guide.md).

## Tips

- Multi Device Key to one Device
- Device Key Alias
- etc.

Refer to [Tips](doc/tips.md)
