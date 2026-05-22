// x402-next's `verifyPayment` returns the *bare* `invalidReason` when the
// facilitator answers 200 with `isValid:false`, but when the facilitator
// answers non-200 useFacilitator throws a `VerifyError` whose message is
// `"Failed to verify payment: <invalidReason>"` — withX402's catch echoes
// that string into the response `error` field. Strip the prefix so the
// retry-set comparison sees the same x402 spec token in both shapes.
export const VERIFY_ERROR_PREFIX = 'Failed to verify payment: '

// x402 spec error codes (subset of ErrorReasons in coinbase/x402 core) where
// re-calling the facilitator's /verify with the SAME X-PAYMENT is worth a try
// — the rejection looks structural (`invalid_payload`) or signature-/time-
// related but the underlying authorization is still valid. Excludes terminal
// mismatches the buyer would have to re-sign for (`insufficient_funds`,
// `invalid_payment_requirements`, `invalid_scheme`, …).
export const RETRYABLE_VERIFY_REASONS: ReadonlySet<string> = new Set([
  'invalid_payload',
  'invalid_exact_evm_payload_signature',
  'invalid_exact_evm_payload_authorization_valid_before',
  'invalid_exact_evm_payload_authorization_valid_after',
  'payment_expired',
  'unexpected_verify_error',
])

export function cdpHost(url: string): string {
  return new URL(url).host
}

export function parseVerifyErrorReason(body: string): string | null {
  try {
    const parsed = JSON.parse(body)
    const raw =
      parsed && typeof parsed === 'object' && typeof parsed.error === 'string'
        ? parsed.error
        : null
    if (!raw) return null
    return raw.startsWith(VERIFY_ERROR_PREFIX) ? raw.slice(VERIFY_ERROR_PREFIX.length) : raw
  } catch {
    return null
  }
}
