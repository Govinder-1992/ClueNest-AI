"""Checks on the authorization settings in backend/cloudformation/cluenest-infrastructure.yaml.
Run from the project root (needs PyYAML):
    python -m unittest discover -s backend/tests -v
They read the template only. Nothing contacts AWS, and no real token is used.

Why scopes: an HTTP API JWT authorizer checks the signature, issuer, audience (or client_id) and expiry.
A Cognito ID token for this app client passes all of those, exactly like an access token, and AWS says
there is no standard way to tell them apart. A route that requires a scope can tell them apart, because
Cognito puts a "scope" claim only in access tokens, and only when the sign-in requested it.
"""
import unittest
from pathlib import Path
import yaml

TEMPLATE = Path(__file__).resolve().parents[1] / "cloudformation" / "cluenest-infrastructure.yaml"
READ, WRITE = "cluenest-api/read", "cluenest-api/write"
EXPECTED_ROUTES = {
    "GET /appliances", "POST /appliances", "GET /appliances/{id}", "PUT /appliances/{id}", "DELETE /appliances/{id}",
    "GET /maintenance", "POST /maintenance", "GET /maintenance/{id}", "PUT /maintenance/{id}",
    "DELETE /maintenance/{id}", "POST /maintenance/{id}/complete",
    "GET /repair-history", "POST /repair-history", "GET /repair-history/{id}", "PUT /repair-history/{id}",
    "DELETE /repair-history/{id}", "POST /troubleshoot", "GET /technicians/search",
    "GET /notifications/preferences", "PUT /notifications/preferences",
}


class _Loader(yaml.SafeLoader):
    pass


def _tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return {suffix: loader.construct_scalar(node)}
    if isinstance(node, yaml.SequenceNode):
        return {suffix: loader.construct_sequence(node, deep=True)}
    return {suffix: loader.construct_mapping(node, deep=True)}


_Loader.add_multi_constructor("!", _tag)
TEMPLATE_DATA = yaml.load(TEMPLATE.read_text(encoding="utf-8"), Loader=_Loader)
RESOURCES = TEMPLATE_DATA["Resources"]
ROUTES = {n: r["Properties"] for n, r in RESOURCES.items() if r["Type"] == "AWS::ApiGatewayV2::Route"}


def authorize(token, route_scopes, now=1_000, issuer="ISS", client="CLIENT"):
    """The documented rules of an HTTP API JWT authorizer. Returns the HTTP status API Gateway gives.
    token is None (no token) or a dict of claims, with "forged": True for a bad signature."""
    if token is None:
        return 401
    if token.get("forged"):
        return 401                                           # signature, kid or algorithm check fails
    if token.get("iss") != issuer:
        return 401
    audience = token["aud"] if "aud" in token else token.get("client_id")     # client_id only when aud is absent
    if audience != client:
        return 401
    if token.get("exp", 0) <= now:
        return 401
    scopes = token.get("scope", "").split() if isinstance(token.get("scope", ""), str) else []
    if route_scopes and not set(route_scopes) & set(scopes):
        return 403                                           # a valid token, but without the route's scope
    return 200


class RouteTests(unittest.TestCase):
    def test_all_20_routes_exist_and_nothing_else(self):
        self.assertEqual({p["RouteKey"] for p in ROUTES.values()}, EXPECTED_ROUTES)
        self.assertEqual(len(ROUTES), 20)

    def test_every_route_uses_the_jwt_authorizer(self):
        for name, p in ROUTES.items():
            self.assertEqual(p["AuthorizationType"], "JWT", name)
            self.assertEqual(p["AuthorizerId"], {"Ref": "JwtAuthorizer"}, name)

    def test_every_route_requires_exactly_one_scope(self):
        for name, p in ROUTES.items():
            method = p["RouteKey"].split()[0]
            self.assertEqual(p.get("AuthorizationScopes"), [READ] if method == "GET" else [WRITE], name)

    def test_no_public_or_catch_all_route(self):
        for name, p in ROUTES.items():
            key = p["RouteKey"]
            self.assertNotIn(key.split()[0], ("ANY", "OPTIONS", "HEAD", "PATCH"), name)
            self.assertNotIn("$default", key, name)
            self.assertNotEqual(p.get("AuthorizationType"), "NONE", name)
        api = RESOURCES["HttpApi"]["Properties"]
        self.assertNotIn("Target", api)                       # no default route created with the API
        self.assertNotIn("RouteKey", api)

    def test_stage_waits_for_every_route(self):
        depends = RESOURCES["ApiStage"]["DependsOn"]
        self.assertEqual({n for n in ROUTES}, set(depends) & set(ROUTES))

    def test_get_routes_are_read_only_and_every_other_method_needs_write(self):
        reads = {p["RouteKey"] for p in ROUTES.values() if p["AuthorizationScopes"] == [READ]}
        self.assertTrue(all(k.startswith("GET ") for k in reads))
        self.assertEqual(len(reads), 8)                      # 3 lists, 3 single reads, technician search, notification setting
        self.assertIn("GET /technicians/search", reads)
        writes = {p["RouteKey"] for p in ROUTES.values() if p["AuthorizationScopes"] == [WRITE]}
        self.assertIn("POST /troubleshoot", writes)
        self.assertIn("POST /maintenance/{id}/complete", writes)
        self.assertEqual(len(reads) + len(writes), 20)


class AuthorizerTests(unittest.TestCase):
    def test_one_jwt_authorizer_for_this_pool_and_client(self):
        auths = {n: r["Properties"] for n, r in RESOURCES.items() if r["Type"] == "AWS::ApiGatewayV2::Authorizer"}
        self.assertEqual(list(auths), ["JwtAuthorizer"])
        a = auths["JwtAuthorizer"]
        self.assertEqual(a["AuthorizerType"], "JWT")
        self.assertEqual(a["IdentitySource"], ["$request.header.Authorization"])
        self.assertEqual(a["JwtConfiguration"]["Audience"], [{"Ref": "UserPoolClient"}])
        self.assertEqual(a["JwtConfiguration"]["Issuer"],
                         {"Sub": "https://cognito-idp.${AWS::Region}.amazonaws.com/${UserPool}"})


class CognitoTests(unittest.TestCase):
    def test_resource_server_defines_the_two_scopes(self):
        rs = RESOURCES["UserPoolResourceServer"]["Properties"]
        self.assertEqual(rs["UserPoolId"], {"Ref": "UserPool"})
        self.assertEqual(rs["Identifier"], "cluenest-api")
        self.assertEqual([s["ScopeName"] for s in rs["Scopes"]], ["read", "write"])
        for s in rs["Scopes"]:
            self.assertTrue(s["ScopeDescription"])

    def test_existing_app_client_allows_and_waits_for_the_scopes(self):
        client = RESOURCES["UserPoolClient"]
        self.assertEqual(client["DependsOn"], "UserPoolResourceServer")
        p = client["Properties"]
        self.assertEqual(p["AllowedOAuthScopes"], ["openid", "email", "profile", READ, WRITE])
        self.assertEqual(p["AllowedOAuthFlows"], ["code"])               # no implicit flow, so no token in the URL
        self.assertIs(p["AllowedOAuthFlowsUserPoolClient"], True)
        self.assertIs(p["GenerateSecret"], False)
        self.assertEqual(p["SupportedIdentityProviders"], ["COGNITO"])

    def test_still_one_pool_one_client_one_api_one_domain(self):
        count = lambda t: sum(1 for r in RESOURCES.values() if r["Type"] == t)
        self.assertEqual(count("AWS::Cognito::UserPool"), 1)
        self.assertEqual(count("AWS::Cognito::UserPoolClient"), 1)
        self.assertEqual(count("AWS::ApiGatewayV2::Api"), 1)
        self.assertEqual(count("AWS::Cognito::UserPoolDomain"), 1)
        self.assertEqual(count("AWS::Lambda::Function"), 7)           # 6 behind the API, plus the daily reminder check (EventBridge only)


class AuthorizerBehaviourModel(unittest.TestCase):
    """The six cases of the requirement, run through the documented rules against the real route scopes."""
    ACCESS = {"iss": "ISS", "client_id": "CLIENT", "token_use": "access", "exp": 2_000,
              "scope": "openid email profile cluenest-api/read cluenest-api/write"}
    ID = {"iss": "ISS", "aud": "CLIENT", "token_use": "id", "exp": 2_000, "email": "a@example.test"}   # no scope claim

    def scopes(self, route_key):
        return next(p["AuthorizationScopes"] for p in ROUTES.values() if p["RouteKey"] == route_key)

    def test_the_old_configuration_accepted_id_tokens(self):
        self.assertEqual(authorize(self.ID, []), 200)                    # no route scopes: why the ID token got 200
        self.assertEqual(authorize(self.ACCESS, []), 200)

    def test_requirement_table_on_every_route(self):
        for p in ROUTES.values():
            scopes = p["AuthorizationScopes"]
            self.assertEqual(authorize(None, scopes), 401, p["RouteKey"])                                   # no token
            self.assertEqual(authorize({"forged": True, **self.ACCESS}, scopes), 401, p["RouteKey"])         # forged
            self.assertEqual(authorize({**self.ACCESS, "exp": 500}, scopes), 401, p["RouteKey"])             # expired access token
            self.assertEqual(authorize(self.ID, scopes), 403, p["RouteKey"])                                 # ID token: refused
            no_scope = {**self.ACCESS, "scope": "openid email profile"}
            self.assertEqual(authorize(no_scope, scopes), 403, p["RouteKey"])                                # access token, no API scope
            self.assertEqual(authorize(self.ACCESS, scopes), 200, p["RouteKey"])                             # access token with scope

    def test_a_read_only_token_cannot_change_data(self):
        read_only = {**self.ACCESS, "scope": "openid cluenest-api/read"}
        self.assertEqual(authorize(read_only, self.scopes("GET /appliances")), 200)
        self.assertEqual(authorize(read_only, self.scopes("POST /appliances")), 403)
        self.assertEqual(authorize(read_only, self.scopes("DELETE /appliances/{id}")), 403)
        write_only = {**self.ACCESS, "scope": "cluenest-api/write"}
        self.assertEqual(authorize(write_only, self.scopes("GET /appliances")), 403)

    def test_tokens_from_another_client_or_issuer_are_401(self):
        scopes = self.scopes("GET /appliances")
        self.assertEqual(authorize({**self.ACCESS, "client_id": "OTHER"}, scopes), 401)
        self.assertEqual(authorize({**self.ACCESS, "iss": "OTHER"}, scopes), 401)


if __name__ == "__main__":
    unittest.main(verbosity=2)
