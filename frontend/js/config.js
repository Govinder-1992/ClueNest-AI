// ClueNest AI frontend configuration.
// Public values only. NEVER put AWS access keys, client secrets, tokens or a Google key here.
// Everything below can be read by anyone who opens the site. Values come from the stack outputs of
// cluenest-infrastructure-dev (see backend/README.md, "Cognito hosted sign-in").
(function () {
  // Where Cognito sends the browser back after sign-in and sign-out. Both addresses must be registered
  // on the app client EXACTLY (stack parameters FrontendCallbackUrl and FrontendLogoutUrl, plus the
  // CloudFront address the stack adds itself). Cognito refuses any other address.
  //  - Hosted site (https, for example https://dxxxx.cloudfront.net): its own address.
  //  - Local development: http://localhost:5500/. Start the site with "python -m http.server 5500" from
  //    the frontend folder and open http://localhost:5500/ (not 127.0.0.1).
  const origin = (window.location && window.location.origin) || "";
  const back = /^https:\/\/[^/]+$/i.test(origin) ? origin + "/" : "http://localhost:5500/";
  window.CLUENEST_CONFIG = {
    // Stack output ApiBaseUrl (includes the stage, no trailing slash).
    apiBaseUrl: "https://ttgu8aq0bh.execute-api.us-east-1.amazonaws.com/dev",
    // Path of the backend technician-search endpoint. The backend calls Google Places.
    // NEVER put a Google API key in this frontend.
    technicianSearchPath: "/technicians/search",
    // Optional support contact shown on the Settings screen. Leave empty if there is none.
    supportEmail: "",
    supportUrl: "",
    // Cognito details (public identifiers only, no secrets).
    cognito: {
      region: "us-east-1",
      userPoolId: "us-east-1_V3CRnV5wU",                                    // stack output UserPoolId
      clientId: "2o0tmubl9bksl35dpkobg3tcu1",                               // stack output UserPoolClientId (a public client: no secret)
      hostedUiDomain: "cluenest-ai-dev.auth.us-east-1.amazoncognito.com",   // stack output CognitoHostedUiDomain
      redirectUri: back,
      logoutUri: back
    }
  };
})();