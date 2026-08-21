# Deployment Runbook

Steps to deploy marmiflix (the lunchbox-queue app) to production.

## 1. Create the Vercel project

1. Go to https://vercel.com/new and import this repository.
2. Framework preset: Next.js (auto-detected). Leave build/output settings at their defaults.
3. Deploy. The first deploy will fail or serve a broken app until the Redis
   integration (step 2) is installed and its env vars are set - that's expected.

## 2. Install the Upstash Redis integration

1. In the Vercel project, go to **Storage** → **Browse Marketplace** → **Upstash**.
2. Install the Upstash integration and create (or connect) a Redis database.
3. The integration provisions `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   as project env vars automatically - no manual copy/paste needed.
4. Redeploy the project (Vercel → Deployments → Redeploy) so the new env vars
   take effect.

## 3. Required environment variables

Set for the Production environment (the Upstash integration sets these for you
in step 2 - verify both are present under **Settings → Environment Variables**):

| Variable | Source |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Set automatically by the Upstash Marketplace integration |
| `UPSTASH_REDIS_REST_TOKEN` | Set automatically by the Upstash Marketplace integration |

See `.env.example` for the full description of what these values are for.

## 4. Set up Web Push notifications (queue-notifications)

1. Generate a VAPID key pair locally: `npx web-push generate-vapid-keys`. This
   prints a Public Key and a Private Key - keep the private key secret.
2. In the Vercel project, go to **Settings → Environment Variables** and add,
   for the Production environment:

   | Variable | Value |
   | --- | --- |
   | `VAPID_PUBLIC_KEY` | The generated Public Key |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | The same Public Key (must match `VAPID_PUBLIC_KEY` exactly - the browser bundle reads this `NEXT_PUBLIC_` copy) |
   | `VAPID_PRIVATE_KEY` | The generated Private Key |
   | `VAPID_SUBJECT` | An `https:` or `mailto:` URI you control (e.g. `mailto:you@example.com` or `https://marmiflix.cruz.dev.br`) |

   See `.env.example` for the same descriptions inline with the other env vars.
3. Redeploy the project so the new env vars take effect.
4. No extra build configuration is needed for the service worker: `public/sw.js`
   is a plain static file that Next.js serves as-is from the site root
   (`/sw.js`) on every deploy - there's no bundler step, no build flag, and no
   separate registration to configure server-side.

## 5. Add the custom domain

1. In the Vercel project, go to **Settings → Domains**.
2. Add `marmiflix.cruz.dev.br`.
3. Vercel will show the DNS record to add (typically a `CNAME` pointing at
   `cname.vercel-dns.com`, or an `A`/`ALIAS` record - follow whatever Vercel
   displays for this exact domain, since the required record type can vary).
4. At the `cruz.dev.br` DNS registrar/host, add that record for the
   `marmiflix` subdomain.
5. Wait for DNS propagation and for Vercel's domain status to show "Valid
   Configuration."

## Rollback

Vercel keeps every deployment. To roll back, go to **Deployments**, find a
previous known-good deployment, and use **Promote to Production**.
