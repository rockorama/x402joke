# Debug commands

Replace the signature/auth fields with the latest `/sign` output, then run step-by-step.

## 1. Get a 402 + payment requirements

```
curl -sS -X POST http://localhost:4021/api/buy -H "Content-Type: application/json" -d '{"theme":"programming"}'
```

## 2. Sign via Hightop

Fill in agent id + api key.

```
curl -sS -X POST http://localhost:3000/api/actions/x402/sign \
  -H "Content-Type: application/json" \
  -H "x-agent-id: <YOUR_AGENT_ID>" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -d '{"payTo":"0x2FE28Ddb76D6147D5888B1b725B0F2237676E7E6","amount":"10000","targetUrl":"http://localhost:4021/api/buy"}'
```

## 3. Buy the joke

Paste the returned `paymentHeader` into `X-PAYMENT`.

```
curl -sS -X POST http://localhost:4021/api/buy \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <paymentHeader>" \
  -d '{"theme":"programming"}'
```

## 4. Directly verify against the facilitator

Edit the signature / authorization fields to match a fresh `/sign` output.

```
cat > /tmp/x402-verify.json <<'EOF'
{
  "x402Version": 1,
  "paymentPayload": {
    "x402Version": 1,
    "scheme": "exact",
    "network": "base",
    "payload": {
      "signature": "0xSIGNATURE",
      "authorization": {
        "from": "0xFROM",
        "to": "0x2FE28Ddb76D6147D5888B1b725B0F2237676E7E6",
        "value": "10000",
        "validAfter": "0",
        "validBefore": "VALID_BEFORE",
        "nonce": "0xNONCE"
      }
    }
  },
  "paymentRequirements": {
    "scheme": "exact",
    "network": "base",
    "maxAmountRequired": "10000",
    "resource": "http://localhost:4021/api/buy",
    "description": "A custom Claude-generated joke, delivered fresh.",
    "mimeType": "application/json",
    "payTo": "0x2FE28Ddb76D6147D5888B1b725B0F2237676E7E6",
    "maxTimeoutSeconds": 60,
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "extra": { "name": "USD Coin", "version": "2" }
  }
}
EOF
```

```
curl -iL -sS -X POST https://x402.org/facilitator/verify \
  -H "Content-Type: application/json" \
  -d @/tmp/x402-verify.json | head -60
```

`-iL` follows redirects and shows all headers so we can see where the real facilitator lives.

## 5. Error-case probes

Malformed header:

```
curl -sS -X POST http://localhost:4021/api/buy \
  -H "X-PAYMENT: garbage" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Empty header:

```
curl -sS -X POST http://localhost:4021/api/buy \
  -H "X-PAYMENT: " \
  -H "Content-Type: application/json" \
  -d '{}'
```
