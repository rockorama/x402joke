# x402joker

Tiny standalone x402 seller. Takes USDC, returns a Claude-generated joke. No durable state — no DB, no auth; the only state is a best-effort per-Lambda idempotency cache (see Caching).

Built as a Next.js app so it deploys to Vercel with a `git push`. Uses the `x402-next` `withX402` wrapper for the payment protocol, signs against the Coinbase CDP facilitator by default, and registers itself with the x402 Bazaar.

## Flow

```
┌──────────┐  POST /api/buy (no X-PAYMENT)  ┌──────────┐
│  client  │ ────────────────────────────▶  │ x402joker│
└──────────┘  ◀── 402 + paymentReqs ─────── └──────────┘
     │
     │  POST hightop /api/actions/x402/sign (payTo, amount)
     │  ◀── { paymentHeader }
     │
     │  POST /api/buy with X-PAYMENT: <paymentHeader>
     │  ──────────────────────────▶
     │                            x402joker → facilitator.verify (with retries)
     │                            x402joker → Claude (generateJoke)
     │                            x402joker → facilitator.settle
     │  ◀── 200 { joke } + X-PAYMENT-RESPONSE (tx hash)
```

## Dev

```bash
cp .env.example .env.local   # Next.js reads .env.local automatically
# fill in JOKE_SHOP_PAYEE_ADDRESS + ANTHROPIC_API_KEY
# also CDP_API_KEY_ID + CDP_API_KEY_SECRET if you keep the default (CDP) facilitator
npm install
npm run dev                   # http://localhost:4021
```

## Deploy to Vercel

```bash
npx vercel         # first time — links the project
npx vercel deploy --prod
```

Set env vars in the Vercel dashboard:
- `JOKE_SHOP_PAYEE_ADDRESS` (required) — EOA that receives USDC.
- `ANTHROPIC_API_KEY` (required).
- `X402_FACILITATOR_URL` (optional, defaults to `https://api.cdp.coinbase.com/platform/v2/x402`). Use `https://x402.org/facilitator` only for `base-sepolia`.
- `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` (required when using the CDP facilitator — i.e. the default). Create at portal.cdp.coinbase.com → API Keys. Used to sign per-request JWTs against `/verify`, `/settle`, `/supported`.
- `X402_NETWORK` (optional, defaults to `base`; also accepts `base-sepolia`).
- `JOKE_PRICE_USD` (optional, defaults to `$0.01`).

## Endpoints

- `GET /` — human landing page with live price/network/payee.
- `GET /llms.txt` — markdown overview tuned for LLM/agent crawlers.
- `GET /api/buy` — JSON description of the paid endpoint (price, asset, payee, flow, discovery links).
- `POST /api/buy` — x402-gated. Body: `{ theme?: string }`.
  - No `X-PAYMENT` → `402` with `accepts: [paymentRequirements]` in body.
  - With valid `X-PAYMENT` → `200 { joke, theme }` + settlement tx hash in `X-PAYMENT-RESPONSE`.

## x402 Bazaar discovery

The `withX402` config marks the resource as `discoverable: true` and ships an `inputSchema` (the optional `theme` field) and `outputSchema` (an example `{ joke, theme }`). `x402-next` spreads those into `paymentRequirements.outputSchema.input` / `.output`. The CDP facilitator indexes the resource on its first paid `/verify` call, so a single settled purchase puts the endpoint into the public Bazaar listing at:

```
GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources
```

`maxTimeoutSeconds` is set to **120s** to give the CDP facilitator headroom — Base block confirmation can run 10–28s and the verify queue adds further latency, so the spec's `validBefore < now + 6s` floor leaves 60s on the edge.

## Verify retries

The CDP facilitator occasionally rejects a freshly-signed authorization with `invalid_payload` (or a related transient reason) before its own state settles. The POST handler re-invokes `withX402` up to **4 attempts** with a **1s pause** between attempts, gated by a retryable-reasons set:

- `invalid_payload`
- `invalid_exact_evm_payload_signature`
- `invalid_exact_evm_payload_authorization_valid_before`
- `invalid_exact_evm_payload_authorization_valid_after`
- `payment_expired`
- `unexpected_verify_error`

Terminal rejections (`insufficient_funds`, `invalid_payment_requirements`, …) break out immediately. The buyer's body stream is only consumed after verify passes, so retrying the wrapper is safe. Final non-2xx responses are logged with status, attempt count, payer, and facilitator reason.

## Caching

The same signed `X-PAYMENT` (same EIP-3009 `from` + `nonce`) is single-use on-chain but agents do replay it on retry. Two cache layers short-circuit the work:

1. **In-memory idempotency cache.** Keyed by `(authorization.from, authorization.nonce)`, lower-cased. On hit we replay the previous 2xx response — same body, same `X-PAYMENT-RESPONSE` header — without re-calling Claude and without asking the facilitator to settle again (which would come back `duplicate_settlement`). Entries expire when `validBefore` passes; an LRU bound (`CACHE_MAX_ENTRIES = 200`) evicts the oldest. Only 2xx responses are cached — 4xx may be transient and caching them would sabotage recovery.
   - Limitation: in-memory per Lambda instance. Vercel cold starts on a fresh worker miss the cache; warm-worker retries (typical for buyers retrying within a few hundred ms) hit it. An external KV store would close the gap but is out of scope here.
2. **CDN cache hints.** On a successful settle the response carries `Cache-Control: public, s-maxage=31536000, immutable` + `Vary: X-PAYMENT`. Vercel's edge doesn't cache POSTs today, so these are belt-and-suspenders — they pay off the moment any CDN in front of the seller honours POST caching keyed by `X-PAYMENT`.

## Notes

- No durable state — no DB, no auth. Buyer keeps their joke. The in-memory idempotency cache above is the only state, and it's per-Lambda and bounded.
- `withX402` only settles on the facilitator **after** a successful (<400) handler response, so failed joke generations won't charge the buyer.
- See `DEBUG.md` for step-by-step curl probes (kickoff → sign via Hightop → buy → direct facilitator verify → error cases).
