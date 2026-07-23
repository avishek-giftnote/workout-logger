package com.workoutlogger.security.oauth;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.Module;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workoutlogger.domain.oauth.OAuthRegisteredClient;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.security.jackson2.SecurityJackson2Modules;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.jackson2.OAuth2AuthorizationServerJackson2Module;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
import org.springframework.stereotype.Repository;
import org.springframework.util.Assert;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

import static org.springframework.data.mongodb.core.query.Criteria.where;

/**
 * Mongo-backed {@link RegisteredClientRepository}. Spring Authorization Server ships JDBC-only stores and
 * this app is MongoDB, so this maps {@link RegisteredClient} to {@link OAuthRegisteredClient} and back.
 *
 * <p>Sets are stored as {@code List<String>}. {@code clientSettings}/{@code tokenSettings} are serialized to
 * JSON with Spring Security's own Jackson modules (the same approach the framework's JDBC store uses) and
 * stored as blobs, so a framework field addition in a future minor version can't break a write (data-model
 * council ruling). The {@code _id} is the client's own id, so {@code save} upserts by id.
 */
@Repository
public class MongoRegisteredClientRepository implements RegisteredClientRepository {

    private final MongoTemplate mongo;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MongoRegisteredClientRepository(MongoTemplate mongo) {
        this.mongo = mongo;
        ClassLoader cl = getClass().getClassLoader();
        List<Module> modules = SecurityJackson2Modules.getModules(cl);
        this.objectMapper.registerModules(modules);
        this.objectMapper.registerModule(new OAuth2AuthorizationServerJackson2Module());
    }

    @Override
    public void save(RegisteredClient client) {
        Assert.notNull(client, "registeredClient cannot be null");
        mongo.save(toDoc(client));
    }

    @Override
    public RegisteredClient findById(String id) {
        Assert.hasText(id, "id cannot be empty");
        OAuthRegisteredClient doc = mongo.findById(id, OAuthRegisteredClient.class);
        return doc == null ? null : toClient(doc);
    }

    @Override
    public RegisteredClient findByClientId(String clientId) {
        Assert.hasText(clientId, "clientId cannot be empty");
        OAuthRegisteredClient doc = mongo.findOne(new Query(where("clientId").is(clientId)), OAuthRegisteredClient.class);
        return doc == null ? null : toClient(doc);
    }

    private OAuthRegisteredClient toDoc(RegisteredClient c) {
        OAuthRegisteredClient d = new OAuthRegisteredClient();
        d.setId(c.getId());
        d.setClientId(c.getClientId());
        d.setClientIdIssuedAt(c.getClientIdIssuedAt());
        d.setClientSecret(c.getClientSecret());
        d.setClientSecretExpiresAt(c.getClientSecretExpiresAt());
        d.setClientName(c.getClientName());
        d.setClientAuthenticationMethods(map(c.getClientAuthenticationMethods(), ClientAuthenticationMethod::getValue));
        d.setAuthorizationGrantTypes(map(c.getAuthorizationGrantTypes(), AuthorizationGrantType::getValue));
        d.setRedirectUris(List.copyOf(c.getRedirectUris()));
        d.setPostLogoutRedirectUris(List.copyOf(c.getPostLogoutRedirectUris()));
        d.setScopes(List.copyOf(c.getScopes()));
        d.setClientSettings(writeMap(c.getClientSettings().getSettings()));
        d.setTokenSettings(writeMap(c.getTokenSettings().getSettings()));
        return d;
    }

    private RegisteredClient toClient(OAuthRegisteredClient d) {
        RegisteredClient.Builder b = RegisteredClient.withId(d.getId())
                .clientId(d.getClientId())
                .clientIdIssuedAt(d.getClientIdIssuedAt())
                .clientSecret(d.getClientSecret())
                .clientSecretExpiresAt(d.getClientSecretExpiresAt())
                .clientName(d.getClientName())
                .clientSettings(ClientSettings.withSettings(readMap(d.getClientSettings())).build())
                .tokenSettings(TokenSettings.withSettings(readMap(d.getTokenSettings())).build());
        d.getClientAuthenticationMethods().forEach(m -> b.clientAuthenticationMethod(new ClientAuthenticationMethod(m)));
        d.getAuthorizationGrantTypes().forEach(g -> b.authorizationGrantType(new AuthorizationGrantType(g)));
        nullSafe(d.getRedirectUris()).forEach(b::redirectUri);
        nullSafe(d.getPostLogoutRedirectUris()).forEach(b::postLogoutRedirectUri);
        nullSafe(d.getScopes()).forEach(b::scope);
        return b.build();
    }

    private static <T> List<String> map(Set<T> set, Function<T, String> f) {
        return set.stream().map(f).toList();
    }

    private static List<String> nullSafe(List<String> v) {
        return v == null ? List.of() : v;
    }

    private String writeMap(Map<String, Object> data) {
        try {
            return objectMapper.writeValueAsString(data);
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to serialize OAuth client settings", e);
        }
    }

    private Map<String, Object> readMap(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to deserialize OAuth client settings", e);
        }
    }
}
