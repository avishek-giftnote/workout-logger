package com.workoutlogger.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workoutlogger.config.RateLimitProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-IP, fixed-window rate limiter for {@code /api/auth/**} (audit finding C2). Blunts brute-force,
 * credential-stuffing, and BCrypt-CPU-exhaustion against the open login/register endpoints, which run
 * BCrypt on every attempt and have no other throttle.
 *
 * <p>Algorithm: a fixed-window counter. The current window is {@code epochSeconds / windowSeconds};
 * each IP keeps the bucket it last hit plus a count within it, and the (capacity+1)-th request in a
 * window is rejected with a 429. A token bucket would be smoother but this is enough to shed an attack.
 *
 * <p><b>In-memory ONLY.</b> The counter map lives in this JVM, so the limit is per-instance. That is
 * correct for the current single-instance deployment; a multi-instance / horizontally-scaled deploy
 * must move the counter to a shared store (e.g. Redis) so the limit is global rather than per-pod.
 *
 * <p>Registered (with its {@code /api/auth/*} URL pattern and order) by
 * {@link com.workoutlogger.config.RateLimitConfig} — deliberately NOT a {@code @Component}, so it is
 * wired exactly once via the {@code FilterRegistrationBean} and not auto-registered a second time.
 */
public class RateLimitFilter extends OncePerRequestFilter {

    private final RateLimitProperties props;
    private final ObjectMapper json;

    /** IP → its current window. Stale entries are overwritten lazily when the IP's next window opens. */
    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

    public RateLimitFilter(RateLimitProperties props, ObjectMapper json) {
        this.props = props;
        this.json = json;
    }

    /** A single IP's fixed window: the epoch-second bucket it started in + the request count within it. */
    private static final class Window {
        final long bucket;
        int count;
        Window(long bucket, int count) {
            this.bucket = bucket;
            this.count = count;
        }
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        if (!props.enabled() || withinLimit(clientIp(request))) {
            chain.doFilter(request, response);
            return;
        }
        reject(response);
    }

    /** Atomically records this hit and returns true if the IP is still within the window's capacity. */
    private boolean withinLimit(String ip) {
        long bucket = Instant.now().getEpochSecond() / props.windowSeconds();
        Window w = windows.compute(ip, (k, cur) -> {
            if (cur == null || cur.bucket != bucket) {
                return new Window(bucket, 1);   // new IP, or its previous window has rolled over
            }
            cur.count++;
            return cur;
        });
        return w.count <= props.capacity();
    }

    /** Client IP: first hop of {@code X-Forwarded-For} when behind a proxy/LB, else the socket address. */
    private static String clientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            int comma = xff.indexOf(',');
            return (comma >= 0 ? xff.substring(0, comma) : xff).trim();
        }
        return req.getRemoteAddr();
    }

    /** 429 with the SAME {@code {timestamp,status,error,message}} envelope as ApiExceptionHandler.body(...). */
    private void reject(HttpServletResponse response) throws IOException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("timestamp", Instant.now().toString());
        m.put("status", HttpStatus.TOO_MANY_REQUESTS.value());
        m.put("error", HttpStatus.TOO_MANY_REQUESTS.getReasonPhrase());
        m.put("message", "Too many requests — slow down.");
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        json.writeValue(response.getWriter(), m);
    }
}
