# BrainOS Test

## Run locally

Requires Node.js 20 or newer.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and fill in the WhatsApp Business Platform values.
3. Run `npm start` and open `http://localhost:3000`.

The quiz sends a summary-only PDF after completion, and only after the participant checks the consent box. Individual answers are not included in the PDF or the WhatsApp request. The recipient is configured on the server, not in browser code.

## WhatsApp setup

Create a Meta app with the WhatsApp product, configure a WhatsApp Business phone number, and use a recipient number that has opted in and is allowed by the WhatsApp account. Create and get approval for a utility message template with a **document header** and static body text, for example: “Your Brain.OS assessment report is attached.” Set the template name and language in `.env`.

Add the access token, phone number ID, supported Graph API version, and approved template name/language to `.env`. Reports are sent to +91 9342299707, as set in `server.js`; a `WHATSAPP_TO` environment variable does not override this destination. Never put the access token in `brainos.html` or commit `.env`. A test WhatsApp number can only message recipients allowed in the Meta test setup.

For deployment, host the Node service behind HTTPS and configure the environment variables in the hosting provider. The endpoint applies a small in-memory per-IP rate limit; use a persistent rate limiter and CAPTCHA or equivalent bot protection for a public production deployment. This starter does not retain submitted reports.
