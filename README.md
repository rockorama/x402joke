# x402joker

Tiny standalone x402 seller. Takes USDC, returns a Claude-generated joke. Stateless.

Built as a Next.js app so it deploys to Vercel with a `git push`. Uses the `x402-next` `withX402` wrapper for the payment protocol.

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
     │                            x402joker → facilitator.verify
     │                            x402joker → Claude (generateJoke)
     │                            x402joker → facilitator.settle
     │  ◀── 200 { joke } + X-PAYMENT-RESPONSE (tx hash)
```

## Dev

```bash
cp .env.example .env.local   # Next.js reads .env.local automatically
# fill in JOKE_SHOP_PAYEE_ADDRESS + ANTHROPIC_API_KEY
npm install
npm run dev                   # http://localhost:4021
```

## Deploy to Vercel

```bash
npx vercel         # first time — links the project
npx vercel deploy --prod
```

Set env vars in the Vercel dashboard:
- `JOKE_SHOP_PAYEE_ADDRESS` (required)
- `ANTHROPIC_API_KEY` (required)
- `X402_FACILITATOR_URL` (optional, defaults to `https://x402.org/facilitator`)
- `X402_NETWORK` (optional, defaults to `base`)
- `JOKE_PRICE_USD` (optional, defaults to `$0.01`)

## Endpoints

- `GET /` — landing page with usage.
- `POST /api/buy` — x402-gated. Body: `{ theme?: string }`.
  - No `X-PAYMENT` → `402` with `paymentRequirements` in body.
  - With valid `X-PAYMENT` → `200 { joke, theme }` + settlement tx hash in `X-PAYMENT-RESPONSE`.

## Notes

- Stateless — no DB, no auth. Buyer keeps their joke.
- `withX402` only settles on the facilitator **after** a successful (<400) handler response, so failed joke generations won't charge the buyer.
