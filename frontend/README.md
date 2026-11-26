# ClueNest AI Frontend
Plain HTML, CSS and JavaScript. No build step.
## Run locally
```
cd frontend
python -m http.server 5500
```
Open http://localhost:5500/ (use `localhost`, not `127.0.0.1`, and keep port 5500). Cognito only accepts
the callback and logout addresses registered on the app client, which are `http://localhost:5500/`.
## Sign in
Sign-in uses the Cognito hosted pages (authorization code flow with PKCE). While `config.js` is filled in
and nobody is signed in, every screen shows "Sign in / Create account". Sign-up, e-mail verification and
password reset happen on the Cognito pages. After sign-in you return to the screen you were on.
Tokens stay in `sessionStorage` (this tab only), never `localStorage`. The refresh token is not kept.
Sign Out is in Settings. See `backend/README.md`, "Cognito hosted sign-in".
## Hosting
The stack can host the site on S3 + CloudFront (see ackend/README.md, "Frontend hosting section"). On the hosted https address the sign-in return address is the site's own address; locally it stays http://localhost:5500/.
## Tests
`node --test "frontend/tests/*.test.js"` (Node 20 or newer). They fake the network and storage.
## Structure
- `index.html`: app shell (sidebar and content area)
- `css/styles.css`: styling
- `js/config.js`: API and Cognito settings (public values only)
- `js/auth.js`: Cognito sign-in, session and sign-out
- `js/api.js`: API client (sends `Authorization: Bearer <access token>`)
- `js/navigation.js`: menu, appliance actions and hash routing
- `js/app.js`: My Appliances screen, sign-in screen and router