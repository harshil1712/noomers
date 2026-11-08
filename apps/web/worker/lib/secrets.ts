const encoder = new TextEncoder();

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
  return crypto.subtle.timingSafeEqual(
    new Uint8Array(providedDigest),
    new Uint8Array(expectedDigest),
  );
}
