# 部署说明（本 fork）

这是 Leev1s 的个人 fork，上游为 cwxiaos/bark-worker（remote 名 `upstream`）。
用途：自建 Bark 推送服务端，替代公共实例 api.day.app。

## 存储

- 项目采用 **Workers KV**，入口 `main.js`，存储绑定名 `database`。
- 单设备轻量使用，KV 免费额度（读 10 万次/天、写 1 千次/天）远超需求。

## 部署流程

- 推送到 `master` 或手动触发 workflow，即由 GitHub Actions
  （`.github/workflows/deploy.yml`）先做 `node --check main.js`
  语法检查，再用 wrangler-action 部署。
- Actions 需要两个仓库 secret（只存名字，值不进仓库）：
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- `wrangler.jsonc` 里的 KV namespace ID 在 Cloudflare 阶段创建后回填，
  占位符为 `REPLACE_WITH_KV_NAMESPACE_ID`。
- 对外地址：`https://bark.lev1s.workers.dev`（workers.dev，Worker 名 `bark`）。
  自定义域名下推送命中上游已知问题（经域名调用的 Worker 连接 APNs 返回 520，
  见上游 issue #19），故不绑定自定义域名。

## 同步上游

```sh
git fetch upstream
git merge upstream/master
```

本 fork 以 `main.js` 作为 Workers KV 入口，同步上游时请核对入口与部署配置。
