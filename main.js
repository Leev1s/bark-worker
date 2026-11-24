export default {
    async fetch(request, env, ctx) {
        return await handleRequest(request, env, ctx)
    }
}

// Decoding rule, same principle as upstream dc2a328 ("JSON body should
// not be unescaped"): decode a value exactly once, and only where the
// transport leaves it encoded. request.formData(), URLSearchParams and
// request.json() already return decoded values, so decoding them again
// corrupts ordinary text: a literal "%" throws URIError (HTTP 500), a
// literal "%20" silently turns into a space. Only URL path segments
// arrive percent-encoded, and only those are decoded below.

async function handleRequest(request, env, ctx) {
    const allowNewDevice = env.ALLOW_NEW_DEVICE !== undefined ? (env.ALLOW_NEW_DEVICE === 'false' ? false : Boolean(env.ALLOW_NEW_DEVICE)) : true
    const allowQueryNums = env.ALLOW_QUERY_NUMS !== undefined ? (env.ALLOW_QUERY_NUMS === 'false' ? false : Boolean(env.ALLOW_QUERY_NUMS)) : true
    const rootPath = env.ROOT_PATH || '/'
    const basicAuth = env.BASIC_AUTH

    const db = new Database(env)
    const {searchParams, pathname} = new URL(request.url)
    const handler = new Handler(db, { allowNewDevice, allowQueryNums })
    const realPathname = pathname.replace((new RegExp('^' + rootPath.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'))), '/')

    if ((realPathname === '/ui/devices' && request.method === 'GET') ||
        (realPathname === '/ui/ping' && request.method === 'POST')) {
        if (!util.validateBasicAuth(request, basicAuth)) {
            const response = webuiJson({ code: 401, success: false, message: 'Unauthorized' }, 401)
            response.headers.set('WWW-Authenticate', 'Basic realm="Bark"')
            return response
        }
        return webuiApi(request, db, handler)
    }

    switch (realPathname) {
        case '/register': {
            return handler.register(searchParams)
        }
        case '/ping': {
            return handler.ping(searchParams)
        }
        case '/healthz': {
            return handler.healthz(searchParams)
        }
        case '/info': {
            if (!util.validateBasicAuth(request, basicAuth)) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: {
                        'content-type': 'text/plain',
                        'WWW-Authenticate': 'Basic realm="Bark"',
                    }
                })
            }
            return handler.info(searchParams)
        }
        case '/ui': {
            if (request.method === 'GET') return webui()
        }
        default: {
            const pathParts = realPathname.split('/')

            if (pathParts[1]) {
                if (!util.validateBasicAuth(request, basicAuth)) {
                    return new Response('Unauthorized', {
                        status: 401,
                        headers: {
                            'content-type': 'text/plain',
                            'WWW-Authenticate': 'Basic',
                        }
                    })
                }

                const contentType = request.headers.get('content-type')
                let requestBody = {}

                try {
                    if (contentType && contentType.includes('application/json')) {
                        requestBody = await request.json()

                        requestBody = Object.keys(requestBody).reduce((obj, key) => {
                            obj[key.toLowerCase()] = requestBody[key]
                            return obj
                        }, {})
                    }else if (contentType && contentType.includes('application/x-www-form-urlencoded')){
                        const formData = await request.formData()
                        formData.forEach((value, key) => {requestBody[key.toLowerCase()] = value})
                        // formData() already decodes: nothing further to decode here.
                    }else{
                        searchParams.forEach((value, key) => {requestBody[key.toLowerCase()] = value})

                        try {
                            if (pathParts.length === 3) {
                                requestBody.body = decodeURIComponent(pathParts[2])
                            } else if (pathParts.length === 4) {
                                requestBody.title = decodeURIComponent(pathParts[2])
                                requestBody.body = decodeURIComponent(pathParts[3])
                            } else if (pathParts.length === 5) {
                                requestBody.title = decodeURIComponent(pathParts[2])
                                requestBody.subtitle = decodeURIComponent(pathParts[3])
                                requestBody.body = decodeURIComponent(pathParts[4])
                            } else if (pathParts.length > 5) {
                                return new Response(JSON.stringify({
                                    'code': 404,
                                    'message': `Cannot ${request.method} ${realPathname}`,
                                    'timestamp': util.getTimestamp(),
                                }), {
                                    status: 404,
                                    headers: {
                                        'content-type': 'application/json',
                                    }
                                })
                            }
                        } catch (error) {
                            return new Response(JSON.stringify({
                                'code': 500,
                                'message': `url path parse failed: ${error}`,
                                'timestamp': util.getTimestamp(),
                            }), {
                                status: 500,
                                headers: {
                                    'content-type': 'application/json',
                                }
                            })
                        }
                    }

                    if (requestBody.device_keys && typeof requestBody.device_keys === 'string') {
                        if (requestBody.device_keys.startsWith('[') || requestBody.device_keys.endsWith(']')) {
                            requestBody.device_keys = JSON.parse(requestBody.device_keys)
                        } else {
                            requestBody.device_keys = (requestBody.device_keys.trim()).split(',').map(item => item.replace(/['"]/g, '').trim())
                        }

                        if (typeof requestBody.device_keys === 'string') {
                            requestBody.device_keys = [requestBody.device_keys]
                        }
                    }
                } catch (error) {
                    return new Response(JSON.stringify({
                        'code': 400,
                        'message': `request bind failed: ${error}`,
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 400,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                if (requestBody.device_keys && requestBody.device_keys.length > 0) {
                    return new Response(JSON.stringify({
                        'code': 200,
                        'message': 'success',
                        'data': await Promise.all(requestBody.device_keys.map(async (device_key) => {
                            if (!device_key) {
                                return {
                                    code: 400,
                                    message: 'device key is empty',
                                    device_key: device_key,
                                }
                            }

                            const response = await handler.push({...requestBody, device_key})
                            const responseBody = await response.json()
                            return {
                                code: response.status,
                                message: responseBody.message,
                                device_key: device_key,
                            }
                        })),
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                if (realPathname != '/push') {
                    requestBody.device_key = pathParts[1]
                }

                if (!requestBody.device_key) {
                    return new Response(JSON.stringify({
                        'code': 400,
                        'message': 'device key is empty',
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 400,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                return handler.push(requestBody)
            }

            if (realPathname === '/') {
                return new Response('ok', {
                    status: 200,
                    headers: {
                        'content-type': 'text/plain',
                    }
                })
            }

            return new Response(JSON.stringify({
                'code': 404,
                'message': `Cannot ${request.method} ${realPathname}`,
                'timestamp': util.getTimestamp(),
            }), {
                status: 404,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }
    }
}


function webuiJson(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        },
    })
}

function webuiMask(value, head, tail = 0) {
    if (!value) return '…'
    // Always hide at least one character, including for unusually short values.
    if (value.length <= head + tail) return value.slice(0, Math.floor(value.length / 2)) + '…'
    return value.slice(0, head) + '…' + (tail ? value.slice(-tail) : '')
}

async function webuiApi(request, db, handler) {
    try {
        if (request.method === 'GET') {
            const keys = await db.listDeviceKeys()
            return webuiJson(await Promise.all(keys.map(async (key, index) => ({
                index,
                keyMasked: webuiMask(key, 6, 2),
                tokenHint: webuiMask(await db.deviceTokenByKey(key), 8),
            }))))
        }

        let body
        try {
            body = await request.json()
        } catch {
            return webuiJson({ code: 400, success: false, message: '请求体必须是 JSON' }, 400)
        }
        if (!Number.isSafeInteger(body?.index) || body.index < 0) {
            return webuiJson({ code: 400, success: false, message: '设备序号必须是非负整数' }, 400)
        }

        // Resolve the index afresh; raw identifiers never come from the browser.
        const keys = await db.listDeviceKeys()
        const key = keys[body.index]
        if (key === undefined) {
            return webuiJson({ code: 404, success: false, message: '设备不存在，请刷新设备列表' }, 404)
        }
        const token = await db.deviceTokenByKey(key)
        if (!token) {
            return webuiJson({ code: 400, success: false, message: '设备 token 不可用，请重新注册设备' }, 400)
        }

        const response = await handler.push({ device_key: key, title: 'Bark', body: 'ping' })
        const result = await response.json()
        let message = String(result.message || (response.ok ? 'success' : '推送失败'))
        // Upstream errors may echo identifiers; only a redacted message is public.
        for (const secret of [key, token].sort((a, b) => b.length - a.length)) {
            message = message.split(secret).join('[已隐藏]')
        }
        return webuiJson({ code: response.status, success: response.ok, message }, response.status)
    } catch {
        // Exceptions may contain APNs URLs/tokens; keep their details server-side.
        return webuiJson({ code: 503, success: false, message: '控制台请求失败，请稍后重试' }, 503)
    }
}

function webui() {
    return new Response(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bark 自建服务</title>
<style>
:root {
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 17px;
  line-height: 1.47;
  letter-spacing: -0.022em;
  background: #f5f5f7;
  color: #1d1d1f;
  --card: #ffffff;
  --secondary: #6e6e73;
  --muted: #86868b;
  --divider: #d2d2d7;
  --accent: #0071e3;
  --button: #0071e3;
  --button-hover: #0077ed;
  --button-active: #006edb;
  --online: #34c759;
  --error: #ff3b30;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 48px 20px; }
main { max-width: 680px; margin: 0 auto; }
h1, h2 { font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
h1 { margin: 0; font-size: 32px; font-weight: 700; line-height: 1.125; letter-spacing: -0.02em; }
header p { margin: 6px 0 0; font-size: 17px; color: var(--secondary); }
section { margin-top: 28px; }
h2 { margin: 0 16px 7px; font-size: 13px; font-weight: 400; color: var(--muted); letter-spacing: -0.01em; }
.group { padding: 0; background: var(--card); border-radius: 10px; overflow: hidden; }
dl { position: relative; display: grid; grid-template-columns: minmax(5rem, auto) minmax(0, 1fr); margin: 0; }
dt, dd { position: relative; min-height: 44px; padding: 11px 16px; }
dt { color: inherit; padding-right: 8px; }
dd { margin: 0; padding-left: 8px; color: var(--secondary); text-align: right; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
dt:not(:first-child)::after, dd:not(:nth-child(2))::after, dl + dl:not(:empty)::after, .device + .device::after {
  content: ''; position: absolute; top: 0; right: 0; left: 16px; height: 1px; background: var(--divider);
}
dd:not(:nth-child(2))::after { left: 0; }
#status { color: inherit; }
#status::before { content: ''; display: inline-block; width: 10px; height: 10px; margin-right: 8px; border-radius: 50%; background: var(--muted); vertical-align: middle; }
#status[data-state="online"]::before { background: var(--online); }
.device { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 16px; min-height: 44px; padding: 11px 16px; align-items: center; }
.device-key { font-size: 17px; overflow-wrap: anywhere; }
.device-token, .device-result, .device-placeholder { color: var(--muted); font-size: 13px; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.device-token { margin-top: 2px; }
.device-result { grid-column: 1 / -1; }
.device-result:empty { display: none; }
.device-result[data-state="success"] { color: var(--online); }
.device-result[data-state="error"] { color: var(--error); }
.device-placeholder { margin: 0; min-height: 44px; padding: 11px 16px; }
button { font: inherit; padding: 7px 16px; border: 0; border-radius: 980px; background: var(--button); color: #ffffff; font-size: 14px; cursor: pointer; transition: background-color 0.2s; }
button:hover { background: var(--button-hover); }
button:active { background: var(--button-active); }
button:disabled { opacity: 0.5; cursor: wait; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
footer { margin-top: 7px; padding: 0 16px; color: var(--muted); font-size: 13px; letter-spacing: -0.01em; }
footer p { margin: 0; }
@media (max-width: 480px) {
  body { padding-right: 16px; padding-left: 16px; }
}
@media (prefers-color-scheme: dark) {
  :root {
    background: #000000;
    color: #f5f5f7;
    --card: #1c1c1e;
    --secondary: #98989f;
    --muted: #98989f;
    --divider: #38383a;
    --online: #30d158;
    --error: #ff453a;
  }
}
</style>
</head>
<body><main>
<header>
<h1>Bark 自建服务</h1>
<p>本站长的个人推送服务控制台。</p>
</header>
<section aria-labelledby="service-heading"><h2 id="service-heading">服务状态</h2><div class="group"><dl>
<dt>服务</dt><dd>Bark Server</dd>
<dt>状态</dt><dd id="status" role="status">检查中</dd>
</dl><dl id="info"></dl></div></section>
<section aria-labelledby="devices-heading"><h2 id="devices-heading">设备</h2>
<div id="devices" class="group" aria-busy="true"><p class="device-placeholder" role="status">正在加载设备…</p></div></section>
<footer><p>用于查看已注册设备并发送测试通知。Ping 将发送标题为 Bark、正文为 ping 的通知。</p></footer>
</main><script>
const base = new URL('.', location.href);
const status = document.getElementById('status');
fetch(new URL('ping', base)).then(r => r.json()).then(data => {
  status.textContent = data.message === 'pong' ? '在线' : '状态未知';
  status.dataset.state = data.message === 'pong' ? 'online' : 'unknown';
}).catch(() => { status.textContent = '无法连接'; });
fetch(new URL('info', base)).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => {
  const info = document.getElementById('info');
  for (const [key, label] of [['version', '版本'], ['build', '构建时间'], ['arch', '架构'], ['commit', '提交'], ['devices', '设备数']]) {
    if (data[key] === undefined || data[key] === null) continue;
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = String(data[key]); info.append(dt, dd);
  }
}).catch(() => {});
const devices = document.getElementById('devices');
fetch(new URL('ui/devices', base)).then(async response => {
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '设备列表加载失败');
  return data;
}).then(data => {
  devices.replaceChildren();
  if (data.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'device-placeholder';
    empty.textContent = '暂无已注册设备';
    devices.append(empty);
  }
  for (const device of data) {
    const row = document.createElement('div'), identity = document.createElement('div');
    const key = document.createElement('div'), token = document.createElement('div');
    const button = document.createElement('button'), result = document.createElement('div');
    row.className = 'device'; key.className = 'device-key'; token.className = 'device-token';
    key.textContent = device.keyMasked; token.textContent = 'Token · ' + device.tokenHint;
    button.type = 'button'; button.textContent = 'Ping';
    button.setAttribute('aria-label', 'Ping 设备 ' + device.keyMasked);
    result.className = 'device-result'; result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    button.addEventListener('click', async () => {
      button.disabled = true; button.textContent = '发送中…';
      result.textContent = ''; result.removeAttribute('data-state');
      try {
        const response = await fetch(new URL('ui/ping', base), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ index: device.index })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || '推送失败');
        result.dataset.state = 'success'; result.textContent = '✓ ' + data.message;
      } catch (error) {
        result.dataset.state = 'error'; result.textContent = '发送失败：' + error.message;
      } finally { button.disabled = false; button.textContent = 'Ping'; }
    });
    identity.append(key, token); row.append(identity, button, result); devices.append(row);
  }
}).catch(error => {
  const message = document.createElement('p'); message.className = 'device-placeholder';
  message.setAttribute('role', 'status'); message.textContent = '设备加载失败：' + error.message;
  devices.replaceChildren(message);
}).finally(() => devices.setAttribute('aria-busy', 'false'));
</script></body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
    })
}

class Handler {
    constructor(db, options) {
        this.version = 'v2.3.4'
        this.build = '2026-09-12 17:45:41'
        this.arch = 'js'
        this.commit = '3db0918856d5aca4d141300c84d5c7a9f851ba44'
        this.allowNewDevice = options.allowNewDevice
        this.allowQueryNums = options.allowQueryNums
        
        this.register = async (parameters) => {
            const deviceToken = parameters.get('devicetoken')
            let key = parameters.get('key')

            if (!deviceToken) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token is empty',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            if (deviceToken.length > 160) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token is invalid',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            if (!(key && await db.deviceTokenByKey(key) != undefined)) {
                if (this.allowNewDevice) {
                    key = await util.newShortUUID()
                } else {
                    return new Response(JSON.stringify({
                        'code': 500,
                        'message': 'device registration failed: register disabled',
                    }), {
                        status: 500,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }
            }

            await db.saveDeviceTokenByKey(key, deviceToken)

            return new Response(JSON.stringify({
                'code': 200,
                'message': 'success',
                'timestamp': util.getTimestamp(),
                'data': {
                    'key': key,
                    'device_key': key,
                    'device_token': deviceToken,
                },
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.ping = async (parameters) => {
            return new Response(JSON.stringify({
                'code': 200,
                'message': 'pong',
                'timestamp': util.getTimestamp(),
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.healthz = async (parameters) => {
            return new Response('ok', {
                status: 200,
                headers: {
                    'content-type': 'text/plain',
                }
            })
        }

        this.info = async (parameters) => {
            if (this.allowQueryNums) {
                this.devices = await db.countAll()
            }

            return new Response(JSON.stringify({
                'version': this.version,
                'build': this.build,
                'arch': this.arch,
                'commit': this.commit,
                'devices': this.devices,
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.push = async (parameters) => {
            const deviceToken = await db.deviceTokenByKey(parameters.device_key)

            if (deviceToken === undefined) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': `failed to get device token: failed to get [${parameters.device_key}] device token from database`,
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            if (!deviceToken) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token invalid',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            const title = parameters.title || undefined
            const subtitle = parameters.subtitle || undefined
            const body = parameters.body || undefined

            let sound = parameters.sound || undefined
            if (sound) {
                if (!sound.endsWith('.caf')) {
                    sound += '.caf'
                }
            } else {
                sound = '1107'
            }

            const group = parameters.group || undefined
            const call = parameters.call || undefined
            const isArchive = parameters.isarchive || undefined
            const icon = parameters.icon || undefined
            const ciphertext = parameters.ciphertext || undefined
            const level = parameters.level || undefined
            const volume = parameters.volume || undefined
            const url = parameters.url || undefined
            const image = parameters.image || undefined
            const copy = parameters.copy || undefined
            const badge = parameters.badge?.toString()
            const autoCopy = parameters.autocopy || undefined
            const action = parameters.action || undefined
            const iv = parameters.iv || undefined
            const id = parameters.id || undefined
            const _delete = parameters.delete || undefined
            const markdown = parameters.markdown || undefined
            const ttl = parameters.ttl || undefined
            
            // https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
            const aps = {
                'aps': (_delete) ? {
                    'content-available': 1,
                    'mutable-content': 1,
                } : {
                    'alert': {
                        'title': title,
                        'subtitle': subtitle,
                        'body': (!title && !subtitle && !body) ? 'Empty Message' : body,
                        'launch-image': undefined,
                        'title-loc-key': undefined,
                        'title-loc-args': undefined,
                        'subtitle-loc-key': undefined,
                        'subtitle-loc-args': undefined,
                        'loc-key': undefined,
                        'loc-args': undefined,
                    },
                    'badge': undefined,
                    'sound': sound,
                    'thread-id': group,
                    'category': 'myNotificationCategory',
                    'content-available': undefined,
                    'mutable-content': 1,
                    'target-content-id': undefined,
                    'interruption-level': undefined,
                    'relevance-score': undefined,
                    'filter-criteria': undefined,
                    'stale-date': undefined,
                    'content-state': undefined,
                    'timestamp': undefined,
                    'event': undefined,
                    'dimissal-date': undefined,
                    'attributes-type': undefined,
                    'attributes': undefined,
                },
                // ExtParams
                'group': group,
                'call': call,
                'isarchive': isArchive,
                'icon': icon,
                'ciphertext': ciphertext,
                'level': level,
                'volume': volume,
                'url': url,
                'copy': copy,
                'badge': badge,
                'autocopy': autoCopy,
                'action': action,
                'iv': iv,
                'image': image,
                'id': id,
                'delete': _delete,
                'markdown': markdown,
                'ttl': ttl,
            }

            const headers = {
                'apns-topic': undefined,
                'apns-id': undefined,
                'apns-collapse-id': id,
                'apns-priority': undefined,
                'apns-expiration': undefined,
                'apns-push-type': (_delete) ? 'background' : 'alert',
            }

            const apns = new APNs(db)
            const response = await apns.push(deviceToken, headers, aps)

            if (response.status === 200) {
                return new Response(JSON.stringify({
                    'code': 200,
                    'message': 'success',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            } else {
                let message
                const responseText = await response.text()
                
                try {
                    message = JSON.parse(responseText).reason
                } catch (err) {
                    message = responseText
                }

                if ((response.status === 410) || ((response.status === 400) && (message.includes('BadDeviceToken')))) {
                    await db.saveDeviceTokenByKey(parameters.device_key, '')
                }

                return new Response(JSON.stringify({
                    'code': response.status,
                    'message': `push failed: ${message}`,
                    'timestamp': util.getTimestamp(),
                }), {
                    status: response.status,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }
        }
    }
}

class APNs {
    constructor(db) {
        const generateAuthToken = async () => {
            const TOKEN_KEY = `
            -----BEGIN PRIVATE KEY-----
            MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg4vtC3g5L5HgKGJ2+
            T1eA0tOivREvEAY2g+juRXJkYL2gCgYIKoZIzj0DAQehRANCAASmOs3JkSyoGEWZ
            sUGxFs/4pw1rIlSV2IC19M8u3G5kq36upOwyFWj9Gi3Ejc9d3sC7+SHRqXrEAJow
            8/7tRpV+
            -----END PRIVATE KEY-----
            `

            // Parse private key
            const privateKeyPEM = TOKEN_KEY.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '')
            // Decode private key
            const privateKeyArrayBuffer = util.base64ToArrayBuffer(privateKeyPEM)
            const privateKey = await crypto.subtle.importKey('pkcs8', privateKeyArrayBuffer, { name: 'ECDSA', namedCurve: 'P-256', }, false, ['sign'])
            const TEAM_ID = '5U8LBRXG3A'
            const AUTH_KEY_ID = 'LH4T9V5U4R'
            // Generate the JWT token
            const JWT_ISSUE_TIME = util.getTimestamp()
            const JWT_HEADER = btoa(JSON.stringify({ alg: 'ES256', kid: AUTH_KEY_ID })).replace('+', '-').replace('/', '_').replace(/=+$/, '')
            const JWT_CLAIMS = btoa(JSON.stringify({ iss: TEAM_ID, iat: JWT_ISSUE_TIME })).replace('+', '-').replace('/', '_').replace(/=+$/, '')
            const JWT_HEADER_CLAIMS = JWT_HEADER + '.' + JWT_CLAIMS
            // Sign
            const jwtArray = new TextEncoder().encode(JWT_HEADER_CLAIMS)
            const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, jwtArray)
            const signatureArray = new Uint8Array(signature)
            const JWT_SIGNED_HEADER_CLAIMS = btoa(String.fromCharCode(...signatureArray)).replace('+', '-').replace('/', '_').replace(/=+$/, '')
            const AUTHENTICATION_TOKEN = JWT_HEADER_CLAIMS + '.' + JWT_SIGNED_HEADER_CLAIMS

            return AUTHENTICATION_TOKEN
        }

        const getAuthToken = async () => {
            let authToken = await db.authorizationToken()

            if (authToken) {
                return await authToken
            }

            authToken = await generateAuthToken()
            await db.saveAuthorizationToken(authToken)

            return authToken
        }

        this.push = async (deviceToken, headers, aps) => {
            const TOPIC = 'me.fin.bark'
            const APNS_HOST_NAME = 'api.push.apple.com'
            const AUTHENTICATION_TOKEN = await getAuthToken()

            return await fetch(`https://${APNS_HOST_NAME}/3/device/${deviceToken}`, {
                method: 'POST',
                headers: JSON.parse(JSON.stringify({
                    'apns-topic': headers['apns-topic'] || TOPIC,
                    'apns-id': headers['apns-id'] || undefined,
                    'apns-collapse-id': headers['apns-collapse-id'] || undefined,
                    'apns-priority': (headers['apns-priority'] > 0) ? headers['apns-priority'] : undefined,
                    'apns-expiration': headers['apns-expiration'] || util.getTimestamp() + 86400,
                    'apns-push-type': headers['apns-push-type'] || 'alert',
                    'authorization': `bearer ${AUTHENTICATION_TOKEN}`,
                    'content-type': 'application/json',
                })),
                body: JSON.stringify(aps),
            })
        }
    }
}

let cachedAuthToken = {}
let cachedDeviceToken = {}

class Database {
    constructor(env) {
        // Make database private
        const kvStorage = env.database

        this.listDeviceKeys = async () => {
            const keys = []
            let cursor
            do {
                const page = await kvStorage.list(cursor ? { cursor } : {})
                keys.push(...page.keys.map(item => item.name).filter(key => !key.startsWith('_')))
                cursor = page.list_complete ? undefined : page.cursor
            } while (cursor)
            return keys.sort()
        }

        this.countAll = async () => {
            const count = (await this.listDeviceKeys()).length
            return count
        }

        this.deviceTokenByKey = async (key) => {
            const device_key = (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_'

            if (device_key && cachedDeviceToken[device_key]) {
                return cachedDeviceToken[device_key]
            }

            const deviceToken = await kvStorage.get(device_key)

            if (deviceToken) {
                cachedDeviceToken[device_key] = deviceToken
            }

            return deviceToken
        }

        this.saveDeviceTokenByKey = async (key, token) => {
            const device_token = (token || '').replace(/[^a-z0-9]/g, '') || ''
            const deviceToken = await kvStorage.put(key, device_token)

            if (device_token === '') {
                delete cachedDeviceToken[key]
            } else {
                cachedDeviceToken[key] = device_token
            }

            return await deviceToken
        }

        this.deleteDeviceByKey = async (key) => {
            const device_key = (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_'
            const deviceToken = await kvStorage.delete(device_key)

            delete cachedDeviceToken[device_key]

            return await deviceToken
        }

        this.saveAuthorizationToken = async (token) => {
            const timestamp = util.getTimestamp()
            const authToken = await kvStorage.put('_authToken_', JSON.stringify({
                'token': token,
                'time': timestamp,
            }), { expirationTtl: 3000 })

            cachedAuthToken = {
                'token': token,
                'timestamp': timestamp,
            }

            return await authToken
        }

        this.authorizationToken = async () => {
            if (cachedAuthToken && (util.getTimestamp() - cachedAuthToken.timestamp < 3000)) {
                return cachedAuthToken.token
            }

            const result = await kvStorage.get('_authToken_', 'json')

            if (result && result.token && result.time) {
                cachedAuthToken = {
                    'token': result.token,
                    'timestamp': result.time,
                }
                return result.token
            }

            return undefined
        }
    }
}

class Util {
    constructor() {
        this.getTimestamp = () => {
            return Math.floor(Date.now() / 1000)
        }

        this.base64ToArrayBuffer = (base64) => {
            const binaryString = atob(base64)
            const length = binaryString.length
            const buffer = new Uint8Array(length)
            for (let i = 0; i < length; i++) {
                buffer[i] = binaryString.charCodeAt(i)
            }
            return buffer
        }

        this.newShortUUID = async () => {
            const uuid = crypto.randomUUID()
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uuid))
            const hashArray = Array.from(new Uint8Array(hashBuffer))

            return btoa(String.fromCharCode(...hashArray)).replace(/[^a-zA-Z0-9]|[lIO01]/g, '').slice(0, 22)
        }

        const constantTimeCompare = (a, b) => {
            if (typeof a !== 'string' || typeof b !== 'string') { return false }
            if (a.length !== b.length) { return false }
            let result = 0
            for (let i = 0; i < a.length; i++) {
                result |= a.charCodeAt(i) ^ b.charCodeAt(i)
            }
            return result === 0
        }

        this.validateBasicAuth = (request, basicAuth) => {
            if (basicAuth) {
                const authHeader = request.headers.get('Authorization')
                if (typeof authHeader !== 'string' || !authHeader.startsWith('Basic ')) { return false }
                const received = authHeader.slice(6) // Remove 'Basic ' prefix
                const expected = btoa(`${basicAuth}`)
                return constantTimeCompare(received, expected)
            }
            return true
        }
    }
}

const util = new Util()