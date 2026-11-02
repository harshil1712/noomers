const encoder = new TextEncoder();

/**
 * Constant-time comparison for equal-length byte arrays. Callers must
 * compare values of identical length (for example, fixed-size digests);
 * mismatched lengths return false before comparison.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Compares two secret strings without leaking length or prefix
 * information through timing: both values are SHA-256 hashed and the
 * fixed-size digests are compared in constant time.
 */
export async function secretsEqual(provided: string, expected: string): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(providedDigest), new Uint8Array(expectedDigest));
}
