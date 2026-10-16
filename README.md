# Neighborhood API (NestJS + Prisma + Supabase)

## Setup
1. Create a project at supabase.com. Copy the two connection strings from
   Project Settings -> Database into `.env` (copy `.env.example`):
   - `DATABASE_URL` -> pooled, port 6543, with `?pgbouncer=true`
   - `DIRECT_URL`   -> direct/session, port 5432 (used for migrations)
2. `npm install`
3. `npx prisma migrate dev --name init`
4. In the Supabase SQL editor, run `prisma/rls.sql` (locks tables off from Supabase's public REST API;
   this API connects as the postgres role so it is unaffected).
5. `npm run start:dev` -> http://localhost:3000/api

## Endpoints (all except /auth/register|login|refresh need `Authorization: Bearer <accessToken>`)
Auth:     POST /auth/register, /auth/login, /auth/refresh, /auth/logout; GET /auth/me
Orgs:     POST /organizations (type ESTATE|SHOP|CHURCH|MOSQUE); GET /organizations?type=&q=; GET /organizations/mine
          POST /organizations/:id/join; GET /organizations/:id/members?status=PENDING
          PATCH /organizations/:id/members/:membershipId  {status, role?}   (admin approves / makes someone SECURITY)
          POST /organizations/:id/broadcast-email {subject, body}           (admin)
Visitors: POST /visitors; GET /visitors/mine; PATCH /visitors/:id/revoke
          POST /visitors/verify {organizationId, code}; POST /visitors/exit; GET /visitors/log/:organizationId  (security/admin)
Shops:    POST /shops/:orgId/products; PATCH /products/:id; POST /products/:id/stock {delta, reason}
          GET /products?orgId=&q=&inStock=true; GET /products/:id/movements
Chat:     GET /chat/conversations, /chat/requests, /chat/conversations/:id/messages
          POST /chat/send, /chat/conversations/:id/accept|decline; PATCH /chat/privacy {chatPrivacy}
          POST|DELETE /chat/block/:userId;  WebSocket namespace /chat (see chat.gateway.ts)

## Flow to try
1. Register user A, create an ESTATE (A becomes ORG_ADMIN).
2. Register user B, join the estate, A approves B (RESIDENT).
3. Register user C, join the estate, A approves with role SECURITY.
4. B creates a visitor pass; C verifies the code at /visitors/verify.

## Not built yet (schema exists for some)
OTP verification, push notifications (DeviceToken), notices, SOS, tickets, dues/payments, super-admin tools, rate limiting, tests.
