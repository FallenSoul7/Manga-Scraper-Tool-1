# Security Policy

## Scope

This policy covers the original ComiHub application code in this repository, including the React frontend, Express backend, authentication/session integration, library synchronization, and source adapters.

Third-party dependencies, hosting providers, Supabase, Google, source websites, and external content have their own security processes and are not controlled by ComiHub.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through the repository’s private security advisory mechanism when available, or contact support@comihub.top with a concise description, affected component, reproduction steps, and impact. Do not include passwords, access tokens, cookies, private keys, database URLs, or private user data in a report.

We will acknowledge a valid report when practical, investigate it, and coordinate a fix or mitigation. Please do not publicly disclose an unpatched vulnerability or access data that does not belong to you.

## Security expectations

ComiHub is designed with defense in depth, including server-managed sessions, secret redaction, least-privilege database access where supported, origin checks for cookie-authenticated writes, rate limits for sensitive endpoints, security headers, and dependency review. No software can be guaranteed immune from hacking. Security controls must be monitored, updated, and independently reviewed over time.

## Secret handling

Secrets must be stored only in deployment secret managers or local untracked environment files. Never commit credentials, tokens, cookies, private keys, database URLs, or production logs. Rotate any secret that may have been exposed.
