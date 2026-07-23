package com.workoutlogger.security.oauth;

import com.workoutlogger.domain.oauth.OAuthRegisteredClient;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Phase-1 AS integration guard. Gated by RUN_MONGO_TESTS=1 (needs Mongo). Proves the in-process
 * Authorization Server is wired without disturbing the existing /api chain:
 *  - RFC 8414 metadata is served,
 *  - the JWKS endpoint serves ONLY public key material (no private exponent leaks),
 *  - a public PKCE client round-trips through the Mongo-backed RegisteredClientRepository, settings included.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.data.mongodb.uri=${MONGODB_TEST_URI:mongodb://localhost:27017/workoutlogger_oauthtest}"})
@EnabledIfEnvironmentVariable(named = "RUN_MONGO_TESTS", matches = "1")
class OAuthServerIntegrationTest {

    @Autowired MockMvc mvc;
    @Autowired RegisteredClientRepository clients;
    @Autowired MongoTemplate mongo;

    private static MongoTemplate dropRef;

    @org.junit.jupiter.api.BeforeEach
    void keepDropRef() { dropRef = mongo; }

    @AfterAll
    static void cleanup() {
        // Drop the whole throwaway DB (name is a MONGODB_TEST_URI workoutlogger_* target), per the
        // Atlas-hygiene rule — never leave test data lingering on the shared cluster.
        if (dropRef != null) dropRef.getDb().drop();
    }

    @Test
    void metadataEndpointIsServed() throws Exception {
        mvc.perform(get("/.well-known/oauth-authorization-server"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issuer").exists())
                .andExpect(jsonPath("$.authorization_endpoint").exists())
                .andExpect(jsonPath("$.token_endpoint").exists())
                .andExpect(jsonPath("$.jwks_uri").exists());
    }

    @Test
    void jwksEndpointServesOnlyPublicKeyMaterial() throws Exception {
        String body = mvc.perform(get("/oauth2/jwks"))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("\"kty\":\"RSA\"")))
                .andReturn().getResponse().getContentAsString();
        // A JWKS must publish only the public key; the private exponent "d" (and CRT params) must never leak.
        assertThat(body).doesNotContain("\"d\":");
        assertThat(body).doesNotContain("\"p\":");
    }

    @Test
    void registeredClientRoundTripsThroughMongoIncludingSettings() {
        String id = UUID.randomUUID().toString();
        RegisteredClient client = RegisteredClient.withId(id)
                .clientId("mcp-roundtrip-client")
                .clientName("MCP round-trip test")
                .clientAuthenticationMethod(ClientAuthenticationMethod.NONE)   // public (PKCE) client
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN)
                .redirectUri("https://claude.ai/api/mcp/auth_callback")
                .scope("workout:read")
                .scope("workout:write")
                .clientSettings(ClientSettings.builder().requireProofKey(true).requireAuthorizationConsent(true).build())
                .tokenSettings(TokenSettings.builder().accessTokenTimeToLive(Duration.ofMinutes(15)).build())
                .build();

        clients.save(client);

        // persisted as a document in the additive collection
        assertThat(mongo.findById(id, OAuthRegisteredClient.class)).isNotNull();

        RegisteredClient loaded = clients.findByClientId("mcp-roundtrip-client");
        assertThat(loaded).isNotNull();
        assertThat(loaded.getId()).isEqualTo(id);
        assertThat(loaded.getScopes()).containsExactlyInAnyOrder("workout:read", "workout:write");
        assertThat(loaded.getRedirectUris()).containsExactly("https://claude.ai/api/mcp/auth_callback");
        assertThat(loaded.getClientAuthenticationMethods()).contains(ClientAuthenticationMethod.NONE);
        assertThat(loaded.getAuthorizationGrantTypes())
                .contains(AuthorizationGrantType.AUTHORIZATION_CODE, AuthorizationGrantType.REFRESH_TOKEN);
        // the fiddly part: settings (incl. a Duration) survive the JSON round-trip
        assertThat(loaded.getClientSettings().isRequireProofKey()).isTrue();
        assertThat(loaded.getTokenSettings().getAccessTokenTimeToLive()).isEqualTo(Duration.ofMinutes(15));
    }
}
