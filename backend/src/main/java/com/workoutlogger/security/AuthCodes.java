package com.workoutlogger.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HexFormat;

/**
 * Cryptographic helpers for sign-up codes / recovery tokens. Codes/tokens are generated with
 * {@link SecureRandom} and stored ONLY as hashes (peppered, for the low-entropy 6-digit code). Comparison
 * is constant-time to avoid a timing oracle.
 */
public final class AuthCodes {

    private static final SecureRandom RNG = new SecureRandom();

    private AuthCodes() {}

    /** A uniformly-random 6-digit numeric code (000000–999999), zero-padded. */
    public static String sixDigitCode() {
        return String.format("%06d", RNG.nextInt(1_000_000));
    }

    /** A 256-bit URL-safe opaque token (recovery link). Brute-infeasible ⇒ no pepper needed. */
    public static String opaqueToken() {
        byte[] b = new byte[32];
        RNG.nextBytes(b);
        return HexFormat.of().formatHex(b);
    }

    /** SHA-256 of {@code value + pepper}, hex. The pepper defends the small 6-digit code space against
     *  offline precomputation from a DB dump. */
    public static String hash(String value, String pepper) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest((value + pepper).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {   // SHA-256 is always present
            throw new IllegalStateException(e);
        }
    }

    /** Constant-time equality of two hex hashes. */
    public static boolean matches(String hashA, String hashB) {
        if (hashA == null || hashB == null) return false;
        return MessageDigest.isEqual(hashA.getBytes(StandardCharsets.UTF_8), hashB.getBytes(StandardCharsets.UTF_8));
    }
}
