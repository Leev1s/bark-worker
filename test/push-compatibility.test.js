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
