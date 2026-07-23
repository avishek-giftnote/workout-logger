package com.workoutlogger.domain.oauth;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

/**
 * Persisted OAuth client (Spring Authorization Server {@code RegisteredClient}) — a NEW, fully additive
 * collection that touches no existing schema. Spring Authorization Server ships JDBC-only stores, so this
 * app (MongoDB) needs a custom mapping; see {@code MongoRegisteredClientRepository}.
 *
 * <p>{@code clientSettings}/{@code tokenSettings} are stored as JSON blobs (serialized with Spring
 * Security's Jackson modules), NOT strict-typed fields — the framework extends that shape across minor
 * versions, so a typed schema/validator would break on upgrade (data-model council ruling).
 *
 * <p>{@code staleAt} is a nullable TTL marker for reaping idle dynamically-registered (DCR) clients so an
 * open {@code /register} endpoint can't grow this collection without bound; first-party / manually
 * provisioned clients leave it null. The unique index on {@code clientId} and the TTL index on
 * {@code staleAt} are created in {@code MongoSchemaInitializer} (auto-index-creation is off), wired when
 * DCR lands (Phase 4).
 */
@Document("oauth_registered_clients")
public class OAuthRegisteredClient {

    @Id
    private String id;
    private String clientId;
    private Instant clientIdIssuedAt;
    private String clientSecret;                 // nullable for public (PKCE) clients
    private Instant clientSecretExpiresAt;
    private String clientName;
    private List<String> clientAuthenticationMethods;
    private List<String> authorizationGrantTypes;
    private List<String> redirectUris;
    private List<String> postLogoutRedirectUris;
    private List<String> scopes;
    private String clientSettings;               // JSON blob (framework-extensible)
    private String tokenSettings;                // JSON blob (framework-extensible)
    private Instant staleAt;                      // nullable; TTL reap for DCR clients (Phase 4)

    public OAuthRegisteredClient() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getClientId() { return clientId; }
    public void setClientId(String clientId) { this.clientId = clientId; }
    public Instant getClientIdIssuedAt() { return clientIdIssuedAt; }
    public void setClientIdIssuedAt(Instant v) { this.clientIdIssuedAt = v; }
    public String getClientSecret() { return clientSecret; }
    public void setClientSecret(String v) { this.clientSecret = v; }
    public Instant getClientSecretExpiresAt() { return clientSecretExpiresAt; }
    public void setClientSecretExpiresAt(Instant v) { this.clientSecretExpiresAt = v; }
    public String getClientName() { return clientName; }
    public void setClientName(String v) { this.clientName = v; }
    public List<String> getClientAuthenticationMethods() { return clientAuthenticationMethods; }
    public void setClientAuthenticationMethods(List<String> v) { this.clientAuthenticationMethods = v; }
    public List<String> getAuthorizationGrantTypes() { return authorizationGrantTypes; }
    public void setAuthorizationGrantTypes(List<String> v) { this.authorizationGrantTypes = v; }
    public List<String> getRedirectUris() { return redirectUris; }
    public void setRedirectUris(List<String> v) { this.redirectUris = v; }
    public List<String> getPostLogoutRedirectUris() { return postLogoutRedirectUris; }
    public void setPostLogoutRedirectUris(List<String> v) { this.postLogoutRedirectUris = v; }
    public List<String> getScopes() { return scopes; }
    public void setScopes(List<String> v) { this.scopes = v; }
    public String getClientSettings() { return clientSettings; }
    public void setClientSettings(String v) { this.clientSettings = v; }
    public String getTokenSettings() { return tokenSettings; }
    public void setTokenSettings(String v) { this.tokenSettings = v; }
    public Instant getStaleAt() { return staleAt; }
    public void setStaleAt(Instant v) { this.staleAt = v; }
}
