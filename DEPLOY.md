# 部署说明（本 fork）

这是 Leev1s 的个人 fork，上游为 cwxiaos/bark-worker（remote 名 `upstream`）。
用途：自建 Bark 推送服务端，替代公共实例 api.day.app。

## 选型

- 采用 **KV 变体**：入口 `main_kv.js`，存储绑定名 `database`。
- 单设备轻量使用，KV 免费额度（读 10 万次/天、写 1 千次/天）远超需求；
  D1 相关文件保留在仓库中但不参与部署。

## 部署流程

- 推送到 `master` 或手动触发 workflow，即由 GitHub Actions
  （`.github/workflows/deploy.yml`）先做 `node --check main_kv.js`
  语法检查，再用 wrangler-action 部署。
- Actions 需要两个仓库 secret（只存名字，值不进仓库）：
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- `wrangler.jsonc` 里的 KV namespace ID 在 Cloudflare 阶段创建后回填，
  占位符为 `REPLACE_WITH_KV_NAMESPACE_ID`。
- 对外域名：`bark.r3.net.eu.org`（Cloudflare 侧绑定）。

## 同步上游

```sh
git fetch upstream
git merge upstream/master
```

本 fork 只改部署配置、CI 与文档，不改上游源码文件
（`main.js`、`main_kv.js` 等），保证合并上游更新时冲突最小。
