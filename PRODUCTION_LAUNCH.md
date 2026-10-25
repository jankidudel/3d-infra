# Production launch: inspectmesh.com

Canonical public URL: `https://www.inspectmesh.com`. The apex
`https://inspectmesh.com` redirects to the canonical hostname.

1. Add a distinct random `RATE_LIMIT_SECRET` of at least 32 characters to the protected `prod` GitHub Environment, then run the manually dispatched `prod` deployment.
2. In Route 53, copy the nameservers for the new `inspectmesh.com` hosted zone.
3. At the domain registrar, replace the domain nameservers with those Route 53 nameservers. This allows the CDK-created ACM validation records to validate the certificate.
4. Wait for ACM validation and the CloudFront distribution deployment to finish.
5. Confirm Route 53 has A and AAAA alias records for both `inspectmesh.com` and `www.inspectmesh.com` targeting the production distribution.
6. Configure `privacy@inspectmesh.com` as a forwarding alias or mailbox, enable the provider's normal spam filtering, and send a test message.
7. Verify HTTPS, the apex-to-`www` redirect, canonical URLs, `robots.txt`, and `sitemap.xml`.
8. Upload a small STL and verify job creation, S3 upload, polling, each report type, JSON/PDF downloads, rate limiting, and safe errors.
9. Only after those checks, keep production indexing enabled and add the site to Google Search Console manually.

Do not deploy the production stack until the protected GitHub Environment, AWS OIDC role, and registrar access are ready. Hosted development is disabled; local development remains noindex.
