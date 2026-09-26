# ComiHub PayPal subscription setup

The backend is prepared for PayPal REST subscriptions. Add the following values to the Render `comihub-backend` service environment; never expose the client secret in Vercel or a `VITE_*` variable.

```text
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
PAYPAL_WEEKLY_PLAN_ID=...
PAYPAL_MONTHLY_PLAN_ID=...
PAYPAL_QUARTERLY_PLAN_ID=...
FRONTEND_URL=https://comihub.vercel.app
```

## PayPal configuration

- Weekly plan: first cycle USD 1 for 1 week, then USD 2 every week.
- Monthly plan: USD 5 every month.
- Quarterly plan: USD 14 every 3 months.
- Webhook URL: `https://comihub-backend.onrender.com/api/paypal/webhook`.
- Select subscription activation, update, cancellation, suspension, expiration, completed, denied, refunded, and reversed payment events.

## Backend endpoints

- `GET /api/paypal/config` — public readiness information; never returns secrets.
- `GET /api/paypal/status` — authenticated entitlement status.
- `POST /api/paypal/create-subscription` — authenticated checkout creation; body `{ "plan": "weekly" | "monthly" | "quarterly" }`.
- `POST /api/paypal/cancel` — authenticated cancellation request.
- `POST /api/paypal/webhook` — public PayPal callback with signature verification.

The migration creates the `subscriptions` table automatically on the next backend start. Test in Sandbox first, then replace all Sandbox credentials, plan IDs, and webhook ID with Live values and set `PAYPAL_MODE=live`.
