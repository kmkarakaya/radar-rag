# Admin auth

Admin auth protects the admin panel (`/admin`) and the admin API (`/v1/admin/**`). It is off by default (the shipped config has `adminAuth.enabled: false` and no users), which is fine on your own computer; turn it on before other people can reach the server. It does not protect the public `/v1/rag/**` API.

While it is off, anyone who can reach the server can also add or change **embedding services** and **chat services** (and choose the chat LLM): they decide where questions and document text are sent, and the server makes requests to the URLs entered there. These APIs and the panel say so in a warning. Do not expose a server with admin auth off.

When it is on:

- Users log in with a username and password; passwords are stored only as scrypt hashes.
- The login sets an HMAC-signed, `HttpOnly`, `SameSite=Lax` session cookie (`rag_admin_session`, marked `Secure` when `NODE_ENV=production`).
- Roles: `viewer` (read), `operator` (+ create, validate, update, re-index, cancel, upload and delete documents), `admin` (+ delete and bulk delete, and managing embedding services and chat services and choosing the chat LLM, which decide where questions and document text are sent). Each user belongs to a `tenantId` and only sees that tenant's collections.
- Every state-changing admin request needs a single-use action token (CSRF protection), bound to the session, tenant, method and path.
- The admin panel redirects to `/admin/login` when there is no session.

## Setting it up

The quick paths (Docker, and `npm run onboard` without Docker) are in the README under "Secure admin quickstart". By hand:

1. Set `adminAuth.enabled: true` in [config/rag.config.yaml](../config/rag.config.yaml).
2. Provide the session secret: set `RAG_ADMIN_SESSION_SECRET` in the environment (or `.env` for Docker), or write it to `.local/rag_admin_session.secret`. The environment variable wins. The name of the variable is configurable with `adminAuth.sessionSecretEnvVar` (default `RAG_ADMIN_SESSION_SECRET`).
3. Generate a password hash: `npm run admin:hash-password -- "your-password"` (or, in Docker, `docker compose exec backend node dist/admin/passwordHash.js`, which asks for the password).
4. Add the user:

   ```yaml
   adminAuth:
     enabled: true
     cookieName: rag_admin_session
     sessionTtlMs: 28800000
     actionTokenTtlMs: 300000
     sessionSecretEnvVar: RAG_ADMIN_SESSION_SECRET
     users:
       - username: admin
         passwordHash: "scrypt$16384$8$1$64$..."
         role: admin
         tenantId: default
   ```

5. Restart the backend.

## Session flow (for API clients)

1. `POST /v1/admin/auth/login` with `{ "username": "...", "password": "..." }`; the backend verifies the stored `passwordHash` and sets the session cookie.
2. A frontend calls `GET /v1/admin/auth/session` on boot to restore the session.
3. Before each state-changing request, fetch a token with `POST /v1/admin/auth/action-token` and send it as the `x-admin-action-token` header.
4. `POST /v1/admin/auth/logout` clears the cookie.

With auth on, the admin API takes the tenant and user from the session and ignores `x-tenant-id` / `x-user-id` headers. Full request and response details: [admin_api_endpoints.md](./admin_api_endpoints.md) and [http_workflows.md](./http_workflows.md).
