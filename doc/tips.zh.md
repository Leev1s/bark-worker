# Tips

## 一个设备多个Key或Key别名

> [!NOTE]
> 设备token可能会随时间变化.如有多Key使用需求,直接在App中添加多次服务器即可.如果需要使用别名,先在App中添加一次服务器,在数据库中手动修改Key为别名,随后在App中使用重置Key功能指定Key别名.

在 KV namespace 中按如下格式手动修改数据:

KV:
```
key                     value
short_key               00fc13adff785122b4ad28809a3420982341241421348097878e577c991de8f0
t8eb6ELE5ZzyVxhIe9icA8  00fc13adff785122b4ad28809a3420982341241421348097878e577c991de8f0
meSud8TZYBoyAi6cKuBNLi  00fc13adff785122b4ad28809a3420982341241421348097878e577c991de8f0
```

这样, 就可以使用自定义的Key向设备发送信息

## 自定义根路径

修改 `rootPath` 为需要的路径:

```diff
 // 根路径
-- const rootPath = '/'
++ const rootPath = '/custome-path/'
```

> [!NOTE]
> 注意 `rootPath` 的开头和结尾必须是 `/`,使用时 API 地址从 `https://SERVER_ADDRESS` 改为 `https://SERVER_ADDRESS/custome-path`,注意填在 Bark APP 中不要带最后的 `/`。

此功能可配合Cloudflare Routes实现防御.

<!-- <p align="center">
    <img src="images/tips/Screenshot from 2024-06-16 00-11-33.png" width="500">
</p> -->

## Basic Auth
按如下方式设置 `basicAuth`:
```
const basicAuth = 'username:password'
```

<p align="center">
    <img src="images/tips/Screenshot from 2024-09-18 18-13-07.png">
</p>

在发送请求时需要设置Header中的 `Authorization` 为 `Basic base64(username:password)`
