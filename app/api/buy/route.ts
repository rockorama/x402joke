import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { NextRequest, NextResponse } from 'next/server'
import { exact } from 'x402/schemes'
import { withX402 } from 'x402-next'

import { config } from '../../../src/config'
import { generateJoke } from '../../../src/jokes'

const isCdpFacilitator = config.facilitatorUrl.startsWith('https://api.cdp.coinbase.com')

function cdpHost(url: string): string {
  return new URL(url).host
}

async function createCdpAuthHeaders() {
  if (!config.cdpApiKeyId || !config.cdpApiKeySecret) {
    throw new Error('CDP facilitator selected but CDP_API_KEY_ID / CDP_API_KEY_SECRET are not set')
  }
  const host = cdpHost(config.facilitatorUrl)
  const sign = (path: string) =>
    generateJwt({
      apiKeyId: config.cdpApiKeyId,
      apiKeySecret: config.cdpApiKeySecret,
      requestMethod: 'POST',
      requestHost: host,
      requestPath: path,
    })
  const [verifyJwt, settleJwt, supportedJwt] = await Promise.all([
    sign('/platform/v2/x402/verify'),
    sign('/platform/v2/x402/settle'),
    sign('/platform/v2/x402/supported'),
  ])
  return {
    verify: { Authorization: `Bearer ${verifyJwt}` },
    settle: { Authorization: `Bearer ${settleJwt}` },
    supported: { Authorization: `Bearer ${supportedJwt}` },
  }
}

async function handler(request: NextRequest): Promise<NextResponse> {
  let theme: string | null = null
  try {
    const body = (await request.json()) as { theme?: string }
    theme = body.theme?.trim() || null
  } catch {
    // No body is fine — generate a surprise joke.
  }

  // withX402 has already verified the payment by the time this handler runs.
  // Decode the header just to log the payer EOA (the `from` in the EIP-3009 auth).
  const paymentHeader = request.headers.get('X-PAYMENT')
  let payer = 'unknown'
  if (paymentHeader) {
    const decoded = exact.evm.decodePayment(paymentHeader).payload
    if ('authorization' in decoded) payer = decoded.authorization.from
  }

  const joke = await generateJoke(theme)
  console.log(`[x402joker] served joke to ${payer} (theme: ${theme ?? 'surprise'})`)

  return NextResponse.json({ joke, theme })
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const endpoint = new URL('/api/buy', request.url).toString()
  const usdc =
    config.network === 'base-sepolia'
      ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
      : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  return NextResponse.json({
    name: 'x402joker',
    description: 'Pay-per-joke vending machine over the x402 protocol.',
    endpoint,
    method: 'POST',
    protocol: 'x402',
    body: { theme: 'optional string — joke theme, omit for surprise' },
    payment: {
      price: `$${config.price.replace(/^\$/, '').replace(/^\./, '0.')}`,
      network: config.network,
      asset: usdc,
      assetSymbol: 'USDC',
      payTo: config.payee,
      scheme: 'exact',
    },
    flow: [
      'POST endpoint with no X-PAYMENT header → 402 with accepts:[paymentRequirements] in body',
      'Sign EIP-3009 transferWithAuthorization matching the requirements; base64-encode as X-PAYMENT header',
      'Retry POST with X-PAYMENT → 200 { joke } + on-chain settlement tx hash in X-PAYMENT-RESPONSE header',
    ],
    discovery: {
      llmsTxt: new URL('/llms.txt', request.url).toString(),
      humanReadable: new URL('/', request.url).toString(),
    },
    references: {
      spec: 'https://x402.org',
      reference: 'https://github.com/coinbase/x402',
    },
  })
}

const x402Handler = withX402(
  handler,
  config.payee,
  {
    price: config.price,
    network: config.network,
    config: {
      description:
        'Pay-per-joke vending machine: send USDC, get a fresh Claude-generated joke. Optional "theme" picks the topic.',
      mimeType: 'application/json',
      // Base block confirmation can run 10–28s and the CDP facilitator's own
      // verify queue adds further latency. The spec's `validBefore < now + 6s`
      // floor + observed end-to-end timings put 60s at the edge; 120s gives
      // headroom for the facilitator to ingest a freshly-signed authorization
      // before its window expires. See HIG-126.
      maxTimeoutSeconds: 120,
      // x402 Bazaar discovery metadata. x402-next spreads these into
      // paymentRequirements.outputSchema.input / .output; the CDP facilitator
      // catalogs the resource on its first paid /verify call, so a single
      // settled purchase puts the endpoint into the public Bazaar listing
      // (GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources).
      discoverable: true,
      inputSchema: {
        bodyType: 'json',
        bodyFields: {
          theme: {
            type: 'string',
            required: false,
            description: 'Optional joke theme. Omit for a surprise joke.',
            example: 'corgis',
          },
        },
      },
      outputSchema: {
        type: 'json',
        example: {
          joke: "I told my dog he's adopted. He didn't take it well — turns out he already knew, he just hadn't found the right moment to bring it up.",
          theme: 'dogs',
        },
      },
    },
  },
  {
    url: config.facilitatorUrl,
    ...(isCdpFacilitator ? { createAuthHeaders: createCdpAuthHeaders } : {}),
  },
)

// x402 spec error codes (subset of ErrorReasons in coinbase/x402 core) where
// re-calling the facilitator's /verify with the SAME X-PAYMENT is worth a try
// — the rejection looks structural (`invalid_payload`) or signature-/time-
// related but the underlying authorization is still valid. Excludes terminal
// mismatches the buyer would have to re-sign for (`insufficient_funds`,
// `invalid_payment_requirements`, `invalid_scheme`, …).
const RETRYABLE_VERIFY_REASONS: ReadonlySet<string> = new Set([
  'invalid_payload',
  'invalid_exact_evm_payload_signature',
  'invalid_exact_evm_payload_authorization_valid_before',
  'invalid_exact_evm_payload_authorization_valid_after',
  'payment_expired',
  'unexpected_verify_error',
])
// 1 initial + 3 retries. Observed pattern: ~3/5 calls fail on attempt #1 and
// can succeed as late as attempt #3 (2nd retry). 4 attempts × ~3–5s verify
// latency + 3 × 1s delays stays well inside the 120s `maxTimeoutSeconds`
// budget; the retryable-reasons gate keeps permanent failures (insufficient
// funds, recipient mismatch, …) from looping.
const MAX_VERIFY_ATTEMPTS = 4
// Pause before re-calling verify. Same stale-RPC race that motivates the
// buyer-side pre-submit delay — letting the facilitator's RPC pool catch up
// gives the next attempt a meaningfully better chance than an immediate
// re-call.
const VERIFY_RETRY_DELAY_MS = 1_000

// x402-next's `verifyPayment` returns the *bare* `invalidReason` when the
// facilitator answers 200 with `isValid:false`, but when the facilitator
// answers non-200 useFacilitator throws a `VerifyError` whose message is
// `"Failed to verify payment: <invalidReason>"` — withX402's catch echoes
// that string into the response `error` field. Strip the prefix so the
// retry-set comparison sees the same x402 spec token in both shapes.
const VERIFY_ERROR_PREFIX = 'Failed to verify payment: '

function parseVerifyErrorReason(body: string): string | null {
  try {
    const parsed = JSON.parse(body)
    const raw = parsed && typeof parsed === 'object' && typeof parsed.error === 'string' ? parsed.error : null
    if (!raw) return null
    return raw.startsWith(VERIFY_ERROR_PREFIX) ? raw.slice(VERIFY_ERROR_PREFIX.length) : raw
  } catch {
    return null
  }
}

// Per-instance idempotency cache keyed by (authorization.from, nonce). If the
// same X-PAYMENT lands twice on the same warm Lambda, we skip the entire
// withX402 verify+handler+settle round-trip and return the previously-produced
// joke. Saves a Claude API call AND avoids the `duplicate_settlement` 402 a
// second settle would produce against an already-consumed authorization.
// Limitation: in-memory only — Vercel cold starts on a fresh instance miss
// the cache. Fixing that would need an external KV store; out of scope for
// the demo, but a buyer that retries within a few hundred ms typically hits
// the same warm worker.
type CachedPaidResponse = {
  status: number
  body: string
  contentType: string | null
  paymentResponseHeader: string | null
  validBeforeUnix: number
  storedAtUnix: number
}
const CACHE_MAX_ENTRIES = 200
const paidResponseCache = new Map<string, CachedPaidResponse>()

function paymentCacheKey(from: string, nonce: string): string {
  return `${from.toLowerCase()}:${nonce.toLowerCase()}`
}

function getCachedPaidResponse(key: string): CachedPaidResponse | null {
  const entry = paidResponseCache.get(key)
  if (!entry) return null
  const nowUnix = Math.floor(Date.now() / 1000)
  if (nowUnix >= entry.validBeforeUnix) {
    // Authorization window closed — the signed bytes can no longer be used
    // even if a buyer replays them, so the cached response is irrelevant.
    paidResponseCache.delete(key)
    return null
  }
  // LRU touch: re-insert to move to the back of the iteration order.
  paidResponseCache.delete(key)
  paidResponseCache.set(key, entry)
  return entry
}

function putCachedPaidResponse(key: string, entry: CachedPaidResponse): void {
  if (!paidResponseCache.has(key) && paidResponseCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = paidResponseCache.keys().next().value
    if (oldest !== undefined) paidResponseCache.delete(oldest)
  }
  paidResponseCache.set(key, entry)
}

// Each X-PAYMENT bytes-tuple is single-use on-chain (the EIP-3009 nonce can
// only be consumed once), so the response we send for a given X-PAYMENT is
// effectively content-addressed by the header — it can never legitimately
// change. We hint the CDN to cache aggressively, keyed by the header value,
// so a buyer that retries the same payload lands on Vercel's edge cache
// instead of cold-starting our Lambda again (which would re-call Claude and
// then get `duplicate_settlement` back from the facilitator).
//
// Vercel's edge does not cache POST responses by default; the headers are
// belt-and-suspenders behind the in-memory cache below — they pay off when
// (a) Vercel lifts the POST-cache restriction, or (b) the seller sits behind
// a different CDN that does honour POST caching. Cost of setting them when
// nothing honours them: zero.
const REPLAY_CACHE_CONTROL = 'public, s-maxage=31536000, immutable'
const REPLAY_VARY = 'X-PAYMENT'

function applyReplayCacheHeaders(headers: Headers): void {
  headers.set('Cache-Control', REPLAY_CACHE_CONTROL)
  headers.set('Vary', REPLAY_VARY)
}

function reconstructResponse(entry: CachedPaidResponse): Response {
  const headers = new Headers()
  if (entry.contentType) headers.set('Content-Type', entry.contentType)
  if (entry.paymentResponseHeader) headers.set('X-PAYMENT-RESPONSE', entry.paymentResponseHeader)
  applyReplayCacheHeaders(headers)
  return new Response(entry.body, { status: entry.status, headers })
}

type DecodedAuthorization = { from: string; nonce: string; validBeforeUnix: number }

function decodeAuthorization(paymentHeader: string): DecodedAuthorization | null {
  try {
    const decoded = exact.evm.decodePayment(paymentHeader).payload
    if (!('authorization' in decoded)) return null
    const { from, nonce, validBefore } = decoded.authorization
    const validBeforeUnix = Number(validBefore)
    if (!Number.isFinite(validBeforeUnix)) return null
    return { from, nonce, validBeforeUnix }
  } catch {
    return null
  }
}

// withX402 calls the CDP facilitator's /verify before invoking our handler.
// We've measured ~25% of first-verify calls returning `invalid_payload` for
// authorizations that subsequently verify cleanly when re-sent moments later
// — the rejection isn't reproducible from the signed bytes, so it points at a
// transient facilitator-side race (cold cache / replication lag against the
// EOA we just topped up). Re-invoking the handler is safe: the buyer's body
// stream is only consumed AFTER verify passes, so a 402 from attempt #1
// leaves the request body intact for attempt #2. Also reads the rejection
// body back on the FINAL non-2xx so failures land in the runtime logs with
// status + payer + facilitator reason.
export async function POST(request: NextRequest): Promise<Response> {
  // No X-PAYMENT means this is the standard x402 protocol kickoff (client
  // asking us for `accepts:[...]`). Return the 402 unchanged — retry, cache,
  // and rejection-log only apply when a payment was actually presented.
  const paymentHeader = request.headers.get('X-PAYMENT')
  if (!paymentHeader) {
    return await x402Handler(request)
  }

  // Idempotency: a buyer that retries the same signed X-PAYMENT (same nonce)
  // should get the same joke back without burning a fresh Claude call OR a
  // facilitator settle that's just going to come back `duplicate_settlement`.
  // We key by the bytes that uniquely identify the authorization on-chain.
  const auth = decodeAuthorization(paymentHeader)
  const cacheKey = auth ? paymentCacheKey(auth.from, auth.nonce) : null
  if (cacheKey) {
    const cached = getCachedPaidResponse(cacheKey)
    if (cached) {
      console.log(`[x402joker] idempotent cache hit payer=${auth!.from} nonce=${auth!.nonce}`)
      return reconstructResponse(cached)
    }
  }

  let response = await x402Handler(request)
  let attempt = 1
  while (attempt < MAX_VERIFY_ATTEMPTS && response.status === 402) {
    let body = ''
    try {
      body = await response.clone().text()
    } catch {}
    const reason = parseVerifyErrorReason(body)
    if (!reason || !RETRYABLE_VERIFY_REASONS.has(reason)) break
    attempt++
    console.warn(`[x402joker] verify retry attempt=${attempt} previousReason=${reason}`)
    await new Promise((resolve) => setTimeout(resolve, VERIFY_RETRY_DELAY_MS))
    response = await x402Handler(request)
  }

  // Only successful settlements are worth caching: 4xx are usually transient
  // and could resolve on the buyer's next attempt, and caching them would
  // sabotage the buyer's recovery path. 2xx means handler ran + settle landed
  // — both expensive, both safe to short-circuit on replay.
  if (cacheKey && auth && response.status >= 200 && response.status < 300) {
    try {
      const body = await response.clone().text()
      const contentType = response.headers.get('content-type')
      const paymentResponseHeader = response.headers.get('x-payment-response')
      putCachedPaidResponse(cacheKey, {
        status: response.status,
        body,
        contentType,
        paymentResponseHeader,
        validBeforeUnix: auth.validBeforeUnix,
        storedAtUnix: Math.floor(Date.now() / 1000),
      })
    } catch {}
    // Also let the CDN cache the fresh response — the in-memory cache above is
    // the L2 behind the edge. See `applyReplayCacheHeaders` for the rationale.
    applyReplayCacheHeaders(response.headers)
  }

  if (response.status >= 400) {
    let body = ''
    try {
      body = await response.clone().text()
    } catch {}
    const payer = auth?.from ?? 'unknown'
    console.error(
      `[x402joker] payment rejected status=${response.status} attempt=${attempt} payer=${payer} body=${body.slice(0, 1000)}`,
    )
  }
  return response
}
