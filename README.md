# Cotton Record — Online / No Acode Required

This build is designed to run as a hosted website. After deployment, you use it from Chrome like a normal website/PWA. Acode is NOT required for daily use.

## Important architecture

Browser -> Secure server processing -> Record results

The Gemini API key is kept in a server environment variable. It is NOT included in the frontend.

## Deploy on Vercel

1. Create a Vercel account.
2. Import this project/ZIP.
3. Add Environment Variable:
   - `GEMINI_API_KEY` = your Gemini API key
   - `GEMINI_MODEL` = `gemini-2.5-flash` (or another currently available Gemini model)
4. Deploy.
5. Open the generated HTTPS URL in Chrome.
6. Use "Add to Home screen" / "Install app" from Chrome if available.

## Local testing

Requires Node.js and Vercel CLI:
`npx vercel dev`

Then open the local URL it gives you.

## Notes

- AI accuracy is not 100%, especially with unclear Urdu handwriting. The Name Master + verification workflow is intentionally included.
- Maximum 12 images/request in this build.
- Frontend results are stored in the browser's localStorage. For multi-user cloud records, add a database/auth layer next.
