# Tips

## Multi Device Key to One Device & Set Key Alias

> [!NOTE]
> Device token may change after a period of time. If you need to use multiple keys or key alias, you can add the same server in your App for multiple times. If you need to use key alias, you can add the same server in your App, then manually set the key alias in database, and then use the reset key function in App to specify the key alias.

Manually set records in the KV namespace as follows:

KV:
```
key                     value
short_key               00fc13adff785122b4ad28809a3420982341241421348097878e577c991de8f0
t8eb6ELE5ZzyVxhIe9icA8  00fc13adff785122b4ad28809a3420982341241421348097878e577c991de8f0
meSud8TZYBoyAi6cKuBNLi  00fc13adff785122b4ad28809a3420982341241421348097878e577c991de8f0
```

So You Can use Both Keys to push message to your device.

## Custom Root Path

Modify `rootPath` as follow:

```diff
 // Root Path
-- const rootPath = '/'
++ const rootPath = '/custome-path/'
```

> [!NOTE]
> Note `rootPath` must start with `/` and end with `/`, use `https://SERVER_ADDRESS` instead of `https://SERVER_ADDRESS/custome-path`.

This feature can be used with Cloudflare Routes.

<!-- <p align="center">
    <img src="images/tips/Screenshot from 2024-06-16 00-11-33.png" width="500">
</p> -->

## Basic Auth
Set `basicAuth` as follow:
```
const basicAuth = 'username:password'
```

<p align="center">
    <img src="images/tips/Screenshot from 2024-09-18 18-13-07.png">
</p>

When send a request, a header `Authorization` need to be set with `Basic base64(username:password)`.
