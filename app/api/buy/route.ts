import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { NextRequest, NextResponse } from 'next/server'
import { exact } from 'x402/schemes'
import { withX402 } from 'x402-next'

import { config } from '../../../src/config'
import { generateJoke } from '../../../src/jokes'
import {
  cdpHost,
  parseVerifyErrorReason,
  RETRYABLE_VERIFY_REASONS,
} from '../../../src/x402-helpers'

const isCdpFacilitator = config.facilitatorUrl.startsWith('https://api.cdp.coinbase.com')

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
  // asking us for `accepts:[...]`). Return the 402 unchanged — retry and
  // rejection-log only apply when a payment was actually presented.
  const paymentHeader = request.headers.get('X-PAYMENT')
  if (!paymentHeader) {
    return await x402Handler(request)
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
  if (response.status >= 400) {
    let body = ''
    try {
      body = await response.clone().text()
    } catch {}
    let payer = 'unknown'
    try {
      const decoded = exact.evm.decodePayment(paymentHeader).payload
      if ('authorization' in decoded) payer = decoded.authorization.from
    } catch {}
    console.error(
      `[x402joker] payment rejected status=${response.status} attempt=${attempt} payer=${payer} body=${body.slice(0, 1000)}`,
    )
  }
  return response
}
