import assert from 'node:assert/strict'
import test from 'node:test'

import worker from '../main.js'

class FakeKVNamespace {
    constructor() {
        this.values = new Map([
            ['testdevicekey', 'test-device-token'],
            ['_authToken_', JSON.stringify({
                token: 'test-authorization-token',
                time: Math.floor(Date.now() / 1000),
            })],
        ])
    }

    async get(key, type) {
        const value = this.values.get(key) ?? null
        return value !== null && type === 'json' ? JSON.parse(value) : value
    }

    async put(key, value) { this.values.set(key, value) }
    async delete(key) { this.values.delete(key) }
    async list() { return { keys: [...this.values.keys()].map(name => ({ name })), list_complete: true } }
}

function createWorkerContext() {
    const pending = []

    return {
        context: {
            waitUntil(promise) {
                pending.push(promise)
            },
        },
        async settle() {
            await Promise.all(pending)
        },
    }
}

async function push(payload) {
    const apnsRequests = []
    const originalFetch = globalThis.fetch

    globalThis.fetch = async (url, init) => {
        apnsRequests.push({ url, init })
        return new Response(null, { status: 200 })
    }

    try {
        const { context, settle } = createWorkerContext()
        const response = await worker.fetch(new Request('https://worker.example/push', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        }), {
            database: new FakeKVNamespace(),
            ALLOW_NEW_DEVICE: 'false',
            ALLOW_QUERY_NUMS: 'false',
            ROOT_PATH: '/',
        }, context)

        await settle()

        assert.equal(response.status, 200)
        assert.equal(apnsRequests.length, 1)

        return JSON.parse(apnsRequests[0].init.body)
    } finally {
        globalThis.fetch = originalFetch
    }
}

test('GET /ping remains compatible with the client health check', async () => {
    const { context, settle } = createWorkerContext()
    const response = await worker.fetch(new Request('https://worker.example/ping'), {
        database: new FakeKVNamespace(),
        ALLOW_NEW_DEVICE: 'false',
        ALLOW_QUERY_NUMS: 'false',
        ROOT_PATH: '/',
    }, context)

    await settle()

    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.code, 200)
    assert.equal(body.message, 'pong')
    assert.equal(typeof body.timestamp, 'number')
})

test('POST /push preserves the current client contract in the APNs payload', async () => {
    const payload = await push({
        device_key: 'test-device-key',
        title: 'Build complete',
        body: 'All checks passed',
        group: 'Codex',
        sound: 'bell',
        icon: 'https://example.com/icon.png',
        url: 'https://example.com/result',
        copy: 'result-id',
        level: 'active',
        badge: 1,
    })

    assert.deepEqual(payload.aps.alert, {
        title: 'Build complete',
        body: 'All checks passed',
    })
    assert.equal(payload.aps.sound, 'bell.caf')
    assert.equal(payload.aps['thread-id'], 'Codex')
    assert.equal(payload.group, 'Codex')
    assert.equal(payload.icon, 'https://example.com/icon.png')
    assert.equal(payload.url, 'https://example.com/result')
    assert.equal(payload.copy, 'result-id')
    assert.equal(payload.level, 'active')
    assert.equal(payload.badge, '1')
})

test('POST /push preserves badge=0 as a string so Bark can clear the badge', async () => {
    const payload = await push({
        device_key: 'test-device-key',
        title: 'Badge cleared',
        body: 'No unread notifications',
        group: 'Codex',
        badge: 0,
    })

    assert.equal(payload.badge, '0')
})

test('POST /push forwards every supported interruption level', async (t) => {
    for (const level of ['passive', 'active', 'timeSensitive', 'critical']) {
        await t.test(level, async () => {
            const payload = await push({
                device_key: 'test-device-key',
                title: `Level: ${level}`,
                body: 'Compatibility check',
                group: 'Codex',
                level,
            })

            assert.equal(payload.level, level)
        })
    }
})

async function pushForm(params) {
    const apnsRequests = []
    const originalFetch = globalThis.fetch

    globalThis.fetch = async (url, init) => {
        apnsRequests.push({ url, init })
        return new Response(null, { status: 200 })
    }

    try {
        const { context, settle } = createWorkerContext()
        const response = await worker.fetch(new Request('https://worker.example/testdevicekey', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(params).toString(),
        }), {
            database: new FakeKVNamespace(),
            ALLOW_NEW_DEVICE: 'false',
            ALLOW_QUERY_NUMS: 'false',
            ROOT_PATH: '/',
        }, context)

        await settle()

        return {
            status: response.status,
            body: await response.json(),
            apnsPayload: apnsRequests.length ? JSON.parse(apnsRequests[0].init.body) : null,
        }
    } finally {
        globalThis.fetch = originalFetch
    }
}

// Regression: form bodies arrive already decoded, so a literal "%" must
// not be decoded a second time (upstream issue #31 family). The old code
// answered HTTP 500 "url path parse failed" for every push whose text
// contained a bare "%" (e.g. the X rounds with 60% / 50% / 28% / 31%).
test('form POST with a literal % in the body delivers it verbatim', async () => {
    const { status, body, apnsPayload } = await pushForm({
        title: 'X 代刷精选',
        body: '涨 31%',
        group: 'X代刷',
    })

    assert.equal(status, 200)
    assert.equal(body.code, 200)
    assert.equal(apnsPayload.aps.alert.body, '涨 31%')
})

// A literal "%20" in the text is not an encoded space: it must survive
// untouched. A try/catch fallback around the second decode would have
// silently turned it into a space.
test('form POST keeps a literal %20 in the text intact', async () => {
    const { status, apnsPayload } = await pushForm({
        title: 'X 代刷精选',
        body: '100%20 折扣',
        group: 'X代刷',
    })

    assert.equal(status, 200)
    assert.equal(apnsPayload.aps.alert.body, '100%20 折扣')
})

// Only URL path segments arrive percent-encoded, so only those are
// decoded: GET /<key>/<title>/<body> still decodes %XX once.
test('GET path form still decodes percent-encoded segments once', async () => {
    const apnsRequests = []
    const originalFetch = globalThis.fetch

    globalThis.fetch = async (url, init) => {
        apnsRequests.push({ url, init })
        return new Response(null, { status: 200 })
    }

    try {
        const { context, settle } = createWorkerContext()
        const response = await worker.fetch(new Request(
            'https://worker.example/testdevicekey/'
            + encodeURIComponent('标题') + '/' + encodeURIComponent('涨 31%'),
        ), {
            database: new FakeKVNamespace(),
            ALLOW_NEW_DEVICE: 'false',
            ALLOW_QUERY_NUMS: 'false',
            ROOT_PATH: '/',
        }, context)

        await settle()

        assert.equal(response.status, 200)
        const payload = JSON.parse(apnsRequests[0].init.body)
        assert.equal(payload.aps.alert.title, '标题')
        assert.equal(payload.aps.alert.body, '涨 31%')
    } finally {
        globalThis.fetch = originalFetch
    }
})

// More special percent sequences through the form branch: every one of
// these must arrive verbatim. The old double-decode 500'd on the bare /
// truncated / invalid ones and silently corrupted the literal "%25" into
// "%" (and a try/catch fallback would still corrupt that one).
test('form POST passes special percent sequences through verbatim', async (t) => {
    const cases = [
        ['bare % at end', '涨 31%'],
        ['lone %', '%'],
        ['multiple %', '涨 31%，跌 28%'],
        ['truncated escape %2', '进度 50%2'],
        ['invalid hex %zz', '折扣 %zz'],
        ['invalid hex %G1', '错误码 %G1'],
        ['literal %25', '100%25'],
        ['plus sign', 'a+b'],
        ['spaces and emoji', '涨 31% 🚀'],
    ]

    for (const [name, body] of cases) {
        await t.test(name, async () => {
            const { status, apnsPayload } = await pushForm({
                title: 'X 代刷精选',
                body,
                group: 'X代刷',
            })

            assert.equal(status, 200)
            assert.equal(apnsPayload.aps.alert.body, body)
        })
    }
})

test('form POST keeps % in title and markdown verbatim', async () => {
    const { status, apnsPayload } = await pushForm({
        title: '涨 31%',
        body: '正文',
        markdown: '**加粗** 100% 完成',
        group: 'X代刷',
    })

    assert.equal(status, 200)
    assert.equal(apnsPayload.aps.alert.title, '涨 31%')
    assert.equal(apnsPayload.markdown, '**加粗** 100% 完成')
})

// JSON bodies were never supposed to be unescaped (upstream dc2a328):
// a literal % in a JSON push must reach APNs untouched.
test('JSON POST with % in the body is not unescaped', async () => {
    const payload = await push({
        device_key: 'test-device-key',
        title: '标题',
        body: '涨 31%（JSON）',
        group: 'Codex',
    })

    assert.equal(payload.aps.alert.body, '涨 31%（JSON）')
})

// Query-string values arrive decoded via URLSearchParams, same as form:
// a literal % there must pass through verbatim, not 500.
test('GET query form passes % through verbatim', async () => {
    const apnsRequests = []
    const originalFetch = globalThis.fetch

    globalThis.fetch = async (url, init) => {
        apnsRequests.push({ url, init })
        return new Response(null, { status: 200 })
    }

    try {
        const { context, settle } = createWorkerContext()
        const response = await worker.fetch(new Request(
            'https://worker.example/testdevicekey?title='
            + encodeURIComponent('标题%') + '&body=' + encodeURIComponent('涨 31%'),
        ), {
            database: new FakeKVNamespace(),
            ALLOW_NEW_DEVICE: 'false',
            ALLOW_QUERY_NUMS: 'false',
            ROOT_PATH: '/',
        }, context)

        await settle()

        assert.equal(response.status, 200)
        const payload = JSON.parse(apnsRequests[0].init.body)
        assert.equal(payload.aps.alert.title, '标题%')
        assert.equal(payload.aps.alert.body, '涨 31%')
    } finally {
        globalThis.fetch = originalFetch
    }
})
