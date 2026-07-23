# Hosted MCP + OAuth — design brief (council-ratified 2026-07-21)

*Durable plan artifact. The decision record for taking the local stdio MCP (`mcp/`) to a hosted,
multi-user, OAuth-secured Railway service. Produced by a 5-member council (Systems Architect · Backend
Engineer · Security Reviewer · Data Modeler · DevOps). Synthesis preserves dissent; it does not average it.*

## Decision in one paragraph

Add the MCP as a **second Nixpacks Railway service** in the same project, rooted at `mcp/`, reaching the
backend over **private networking**, exposing **Streamable HTTP in stateless mode** as an OAuth 2.1
**Resource Server**. Build the **Authorization Server in-process** in the existing Spring app using
**Spring Authorization Server** (first-party, never hand-rolled), with **RS256/JWKS** tokens, three
**additive Mongo collections**, and `sub` = the Mongo `User._id`. Revocation stays anchored on the one
existing choke point — `tokenVersion`, checked live on **every** request for **every** token type.
Two items are **block-ship gates** (below); everything else is enforceable in review.

## The one real dissent — Fork 1 (token model)

Four members said **dual-accept** (keep the SPA's custom HS256 login untouched; add RS256/JWKS validation
for the MCP path). The **Security Reviewer dissented**: run **one** validator, retire HS256 entirely,
because two live validators on one filter chain is two bug surfaces plus an attacker-exploitable precedence
question — and re-login here is cheap (password only).

**Synthesized decision (a third path that satisfies both):** unify `/api` on a **single RS256/JWKS
validator**, and keep the SPA login UX unchanged by having the first-party `/auth/login` **mint an RS256
token via the AS signing key** (a first-party issuance endpoint, not an OAuth redirect grant — OAuth 2.1
dropped the password grant, so we do not push the SPA through `/authorize`). Result: one validation surface
(Security's ask), no SPA redirect rewrite and the audited signup flow untouched (the majority's ask). The
only new cost is that the login controller mints RS256-via-AS-key instead of HS256-via-`JwtService`; `tv`
is still stamped and checked. At cutover, bump every `tokenVersion` once to invalidate outstanding HS256
tokens.

> Preserved positions: **dual-accept** (Architect, Backend, Data Modeler, DevOps) = least change, but two
> validators. **Full migrate** (Security) = one validator, but risked forcing the SPA into a redirect flow.
> The synthesis takes Security's single-validator and the majority's no-redirect. If you want absolute
> minimal change instead, pure dual-accept is the recorded fallback.

## Fork rulings (2–8)

2. **Revocation.** `tokenVersion` remains the single revocation truth. Stamp `tv` into AS-issued tokens
   (`OAuth2TokenCustomizer`); `/api` keeps the live `findTokenVersionById` lookup for **all** tokens — it
   must **never** switch to signature-only JWKS trust "for speed." Ship an actual `/oauth/revoke` (RFC 7009)
   / logout-all that bumps `tv` (nothing flips it today — a real gap). OAuth access-token TTL **15–60 min +
   rotating refresh**; the 7-day default is too long for a token now handed to third-party DCR'd clients.
   The first-party SPA token may keep a longer expiry.
3. **`sub` + confused-deputy.** `sub` is the Mongo `User._id` hex, no mapping table. Mandatory `aud` on
   every token, checked by **both** MCP and `/api` (reject tokens whose audience doesn't name the resource).
   MCP holds **only** the public JWKS (no signing key, cannot mint/extend). MCP derives identity **only**
   from the verified `Authorization` header of the current inbound request — never config, cache, or a tool
   argument.
4. **DCR (RFC 7591).** Enable but gate: PKCE mandatory for every client; **byte-exact** `redirect_uri` match
   at registration and re-checked on every `/authorize`; rate-limit `/register` (**gap:** today's
   `RateLimitFilter` covers only `/api/auth/**` — the AS endpoints must be added to its patterns); minimum
   default scope floor with no self-elevation; **TTL-reap** idle dynamically-registered clients so an open
   endpoint can't grow `oauth_registered_clients` unbounded.
5. **Scopes — granular, enforced at `/api`.** Majority (Backend, Data, Security) over the Architect's
   coarse-single-`mcp` preference. At minimum `workout:read` / `workout:write` plus a **distinct scope for
   the destructive tools** (`delete_workout`, `end_plan`), enforced by `/api` (`@PreAuthorize` on the
   domain-grouped controllers), **never** at the MCP. The MCP's `DESTRUCTIVE`/`readOnlyHint` annotations are
   LLM-client UI hints, **not** an authorization control. *Dissent (Architect):* coarse is enough while this
   is "a user granting an app access to their own data, not third-party delegation" — overruled because DCR
   makes clients third-party-ish and destructive tools shouldn't come free.
6. **AS placement — in-process** (unanimous). Caveat (Security): a business-logic RCE/SSRF now shares a JVM
   with the token-signing key; move the signing key to a real rotatable secret and ride the same
   `SecurityConfig`/rate-limit discipline, don't bolt it on.
7. **Login/consent UI — the single biggest new attack surface.** A narrowly `securityMatcher`-scoped,
   session-backed `SecurityFilterChain` for `/oauth2/authorize` + `/login` + `/oauth2/consent` only;
   everything else stays `STATELESS`. **CSRF must be re-enabled on this path** (the app-wide
   `csrf().disable()` must not bleed in), plus session-fixation defense and Secure/HttpOnly/SameSite cookies
   — none of which exist in the codebase today. Reuse the existing `UserRepository` + `PasswordEncoder` for
   the credential check (return `UserDetails`, don't mint a JWT). Consent is **required for
   dynamically-registered (Claude) clients**; a pre-registered first-party client may set
   `requireAuthorizationConsent(false)`.
8. **Private networking.** MCP → `/api` over `http://workout-logger.railway.internal:$PORT` (Railway
   internal DNS, **IPv6-only** — verify the JVM isn't IPv4-only-binding, and smoke-test connectivity before
   layering OAuth). `JWKS_URI` resolves over the **private** network; `OAUTH_ISSUER` **must be the public
   HTTPS URL** (RFC 8414 issuer discovery — clients validate `iss` externally). The backend needs **no new
   public exposure**. The `0.0.0.0/0` Atlas ACL is now a **co-requirement**, not deferrable debt — a second
   exposed tier raises the odds of a leaked Mongo credential.

## Threat model (attack → required mitigation)

- **Token substitution** → mandatory `aud`, checked by MCP and `/api` on every request.
- **Confused deputy** → per-request identity seam (never per-connection/per-process — the current
  `resolveLocalToken` process-cache must not survive); MCP holds no signing key; `/api` derives `userId`
  only from the current request's verified `sub`.
- **DCR abuse / DoS** → rate-limit `/register` (add to `RateLimitFilter` patterns), exact redirect-URI
  match, minimal default scope floor, TTL-reap idle clients.
- **Open redirect** → byte-exact `redirect_uri` match at DCR time and on every `/authorize`, no
  wildcard/prefix/subdomain.
- **PKCE downgrade** → PKCE mandatory at the AS for every client; reject any `/authorize` without
  `code_challenge`.
- **Broad Atlas access** → tighten `0.0.0.0/0` to Railway egress IPs or private Atlas, alongside this change.

## Block-ship gates (do not launch without these — as failing tests, not review notes)

- **G1 — revocation funnel.** Every token validator (first-party and OAuth) resolves through the live
  `tokenVersion` DB check. Independently named the biggest risk by the Architect, Data Modeler, and Security
  Reviewer. Guard: bump `tv`, assert an AS-issued token is then rejected by `/api`.
- **G2 — per-request identity.** The MCP identity seam is proven **per-request**, not per-connection, before
  `resolveLocalToken` is retired. Guard: a concurrency test with two simultaneous callers holding two
  different tokens that asserts zero cross-contamination (no cross-tenant read/delete).

## Phased, guard-first implementation sequence

Each phase lands failing tests first, then code, behind its own PR.

- **Phase 0 — connectivity + transport scaffold (reversible).** Second Railway service (Nixpacks, root
  `mcp/`, watch paths `mcp/**`), bind `$PORT`, Streamable HTTP **stateless** transport with **no auth yet**,
  `/health`. Curl-smoke the IPv6 private-network hop backend↔MCP so a networking bug is never debugged
  alongside an auth bug.
- **Phase 1 — AS in-process. ✅ DONE 2026-07-21.** Spring Authorization Server wired additively (second
  `SecurityFilterChain` at `HIGHEST_PRECEDENCE`, existing chain demoted to `@Order(2)`), RS256 keypair via
  `OAuthKeyProvider` (dev ephemeral / prod fail-fast on `OAUTH_SIGNING_JWK`), JWKS + RFC 8414 metadata,
  Mongo-backed `RegisteredClientRepository` (`oauth_registered_clients`, settings as JSON blobs), and the
  `tv` token customizer (gate-G1 seam). Guards: 6 pure (key discipline + RS256 issuance/validation loop with
  sub/tv/aud/scope) + 3 Mongo-gated (metadata, JWKS-public-only, client round-trip incl. `Duration`
  settings). Full default suite still green (176 run). **Scope refinement:** the Mongo-backed
  `OAuth2AuthorizationService` / `OAuth2AuthorizationConsentService` moved to **Phase 4** — nothing populates
  them until the authorize/consent flow exists, so Phase 1 uses the framework's in-memory defaults for those.
- **Phase 2 — `/api` accepts RS256 + `tv`/`aud`. ✅ DONE 2026-07-21.** Extended `JwtAuthenticationFilter` to
  **dual-decode** (HS256 first-party SPA, then RS256 via the AS JWKS) rather than swapping in the
  `oauth2ResourceServer` DSL — so `Tenant`, the `tv` liveness check, and every repo's userId-AND pattern are
  untouched (Backend Engineer's ruling). The RS256 path enforces `aud` = `oauth.api-audience` (confused-deputy
  close) and funnels through the SAME `tokenVersion` check (gate G1). **This is the migration state:** Phase 3
  flips `JwtService` issuance to RS256 and drops the HS256 branch, collapsing to the single validator the
  design settled on. Guards (gated, Atlas): accept valid RS256, **G1** post-`tv`-bump → 401, wrong-`aud` → 401,
  garbage → 401 — plus **`ApiIntegrationTest` 95/95 green** (dual-decode did not regress HS256/SPA auth or
  tenant isolation).
- **Phase 3 — first-party login mints RS256.** `/auth/login` issues via the AS key; bump all `tv` at
  cutover. Guard: SPA login works; old HS256 tokens rejected.
- **Phase 4 — authorize/login/consent + scopes + DCR.** Scoped session chain (CSRF re-enabled,
  session-fixation, secure cookies); **branded consent page**; granular scopes (`workout:read`/`workout:write`
  + a destructive scope) via `@PreAuthorize`; DCR gated (PKCE, exact redirect, `/register` rate limit added to
  `RateLimitFilter`, scope floor, TTL reap). **Also lands here** (moved from Phase 1): the Mongo-backed
  `OAuth2AuthorizationService` + `OAuth2AuthorizationConsentService` (`oauth_authorizations`,
  `oauth_authorization_consents`) that the flow now populates, plus their unique/TTL indexes in
  `MongoSchemaInitializer` and the `oauth_registered_clients` unique(`clientId`)/TTL(`staleAt`) indexes.
  Guards: unauth `/authorize` → redirect to login (not 401); missing PKCE → reject; wrong `redirect_uri` →
  reject; destructive tool requires its scope.
- **Phase 5 — MCP OAuth Resource Server + per-request seam.** Replace `resolveLocalToken` with a per-request
  accessor tied to the inbound request; validate tokens via JWKS + `aud`; serve RFC 9728 protected-resource
  metadata. **Gate G2** lands here.
- **Phase 6 — hardening co-requirements.** Tighten Atlas ACL, signing-key rotation, monitoring on `/register`.

## Railway wiring (checklist)

- Second service in the **same** project from the same repo; root directory `mcp/`; **Nixpacks** (no
  Dockerfile); build `npm ci && npm run build`; start binds `$PORT` (Streamable HTTP — the current stdio
  `npm start` is a no-op on Railway until Phase 0 lands); watch paths `mcp/**`.
- MCP env: `BACKEND_INTERNAL_URL` + `JWKS_URI` (private `…​.railway.internal`), `OAUTH_ISSUER` (public HTTPS).
- Backend env: signing key + client-registration policy as Railway variables (no secrets committed).
- MCP gets a generated public domain (clients connect to it); backend needs no new public exposure; the AS
  endpoints ride the backend's existing domain, same-origin, same cert. Per-service `/health`.
- CI `mcp-gate` stays a **merge** gate; the two services deploy independently (MCP calls the backend only at
  request time, so no deploy ordering is needed).

## Decisions locked (2026-07-21, by Avishek)

1. **Token model: synthesized single-validator RS256.** `/api` runs one RS256/JWKS validator; first-party
   `/auth/login` mints RS256 via the AS key. (Pure dual-accept declined.)
2. **Scopes: `workout:read` / `workout:write` + a distinct destructive scope** gating `delete_workout` /
   `end_plan`, enforced at `/api` via `@PreAuthorize`.
3. **Consent: a branded consent page** in the app's design system (not the Spring AS default). Consequence:
   we own the session-security hardening for it — CSRF re-enabled on that scoped chain, session-fixation
   defense, Secure/HttpOnly/SameSite cookies. This is the biggest new attack surface (Fork 7); treat it as a
   real Phase-4 deliverable, not a template.
4. **Issuer: the Railway-generated hostname** for launch. **Recorded one-way-door:** DCR'd clients bind to
   the issuer URL, so a later move to a custom domain is a breaking reconfiguration for every connected
   client. Acceptable pre-launch (single tester); revisit before real users connect.
