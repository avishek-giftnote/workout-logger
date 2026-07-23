package com.workoutlogger.security.oauth;

import com.nimbusds.jose.jwk.JWKMatcher;
import com.nimbusds.jose.jwk.JWKSelector;
import com.nimbusds.jose.jwk.KeyType;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import com.workoutlogger.domain.User;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.springframework.data.mongodb.core.query.Criteria.where;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Phase-2 resource-server guard (gated by RUN_MONGO_TESTS=1). Proves /api accepts the Authorization
 * Server's RS256 tokens through the dual-decode filter AND that the two hard checks hold end-to-end:
 *  - GATE G1: bumping the user's tokenVersion (password reset / wipe) revokes an already-issued RS256 token,
 *  - confused-deputy close: a token minted for a different audience is rejected even though it's well-signed.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.data.mongodb.uri=${MONGODB_TEST_URI:mongodb://localhost:27017/workoutlogger_oauthrs}"})
@EnabledIfEnvironmentVariable(named = "RUN_MONGO_TESTS", matches = "1")
class OAuthResourceServerIntegrationTest {

    @Autowired MockMvc mvc;
    @Autowired MongoTemplate mongo;
    @Autowired JWKSource<SecurityContext> jwkSource;
    @Value("${oauth.api-audience:workout-logger-api}") String apiAudience;

    private static MongoTemplate dropRef;
    private String userId;

    @BeforeEach
    void seedUser() {
        dropRef = mongo;
        User u = new User();
        u.setEmail("rs-" + System.nanoTime() + "@example.com");
        u.setTokenVersion(0);
        this.userId = mongo.save(u).getId();
    }

    @AfterAll
    static void cleanup() {
        if (dropRef != null) dropRef.getDb().drop();   // throwaway workoutlogger_* DB (Atlas hygiene)
    }

    /** Mint an RS256 token signed by the running AS key, as a given user/tokenVersion/audience. */
    private String mint(String sub, int tv, String audience) throws Exception {
        RSAKey key = (RSAKey) jwkSource.get(
                new JWKSelector(new JWKMatcher.Builder().keyType(KeyType.RSA).build()), null).get(0);
        JwtEncoder encoder = new NimbusJwtEncoder(jwkSource);
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .subject(sub)
                .audience(List.of(audience))
                .claim("tv", tv)
                .claim("scope", "workout:read")
                .issuedAt(now)
                .expiresAt(now.plus(10, ChronoUnit.MINUTES))
                .build();
        JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId(key.getKeyID()).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    @Test
    void acceptsAValidRs256TokenForTheApi() throws Exception {
        mvc.perform(get("/api/workouts").header("Authorization", "Bearer " + mint(userId, 0, apiAudience)))
                .andExpect(status().isOk());
    }

    @Test
    void gateG1_bumpingTokenVersionRevokesAnIssuedToken() throws Exception {
        String token = mint(userId, 0, apiAudience);
        mvc.perform(get("/api/workouts").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());

        // password reset / account wipe bumps tokenVersion — the same live token must now be rejected.
        mongo.updateFirst(new Query(where("_id").is(userId)), new Update().set("tokenVersion", 1), User.class);

        mvc.perform(get("/api/workouts").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsATokenMintedForADifferentAudience() throws Exception {
        mvc.perform(get("/api/workouts").header("Authorization", "Bearer " + mint(userId, 0, "some-other-resource")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsGarbageBearerToken() throws Exception {
        mvc.perform(get("/api/workouts").header("Authorization", "Bearer not.a.jwt"))
                .andExpect(status().isUnauthorized());
    }
}
