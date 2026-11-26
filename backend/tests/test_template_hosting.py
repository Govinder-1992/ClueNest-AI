"""Checks on the frontend hosting resources (S3 + CloudFront) in cluenest-infrastructure.yaml.
Run from the project root (needs PyYAML):   python -m unittest discover -s backend/tests -v
They read the template only. Nothing contacts AWS.
"""
import re
import unittest
from pathlib import Path
import yaml

TEMPLATE = Path(__file__).resolve().parents[1] / "cloudformation" / "cluenest-infrastructure.yaml"
FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


class _Loader(yaml.SafeLoader):
    pass


def _tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return {suffix: loader.construct_scalar(node)}
    if isinstance(node, yaml.SequenceNode):
        return {suffix: loader.construct_sequence(node, deep=True)}
    return {suffix: loader.construct_mapping(node, deep=True)}


_Loader.add_multi_constructor("!", _tag)


class _DuplicateKeyLoader(_Loader):
    """Also used to prove that no logical ID, parameter or output is defined twice."""


def _no_duplicates(loader, node, deep=False):
    seen = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            raise yaml.constructor.ConstructorError(None, None, "duplicate key: %s" % key, key_node.start_mark)
        seen.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep)


_DuplicateKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_duplicates)
TEXT = TEMPLATE.read_text(encoding="utf-8")
DATA = yaml.load(TEXT, Loader=_Loader)
R = DATA["Resources"]
BUCKET = R["FrontendBucket"]["Properties"]
DIST = R["FrontendDistribution"]["Properties"]["DistributionConfig"]


def references(node):
    """Every resource or parameter named by Ref, GetAtt or ${Name} in a Sub."""
    found = set()
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "Ref":
                found.add(v)
            elif k == "GetAtt":
                found.add((v if isinstance(v, str) else v[0]).split(".")[0])
            elif k == "Sub":
                text, local = (v, {}) if isinstance(v, str) else (v[0], v[1] if len(v) > 1 else {})
                found.update(m.split(".")[0] for m in re.findall(r"\$\{([A-Za-z0-9:.]+)\}", text)
                             if not m.startswith("AWS::") and m.split(".")[0] not in local)      # ${Host} may be a local variable
                found.update(references(local))
            else:
                found.update(references(v))
    elif isinstance(node, list):
        for v in node:
            found.update(references(v))
    return found


class BucketTests(unittest.TestCase):
    def test_bucket_is_private(self):
        self.assertEqual(BUCKET["PublicAccessBlockConfiguration"],
                         {"BlockPublicAcls": True, "BlockPublicPolicy": True, "IgnorePublicAcls": True, "RestrictPublicBuckets": True})
        self.assertNotIn("WebsiteConfiguration", BUCKET)
        self.assertNotIn("AccessControl", BUCKET)
        self.assertNotIn("CorsConfiguration", BUCKET)

    def test_ownership_encryption_versioning(self):
        self.assertEqual(BUCKET["OwnershipControls"]["Rules"], [{"ObjectOwnership": "BucketOwnerEnforced"}])
        rule = BUCKET["BucketEncryption"]["ServerSideEncryptionConfiguration"][0]
        self.assertEqual(rule["ServerSideEncryptionByDefault"]["SSEAlgorithm"], "AES256")
        self.assertEqual(BUCKET["VersioningConfiguration"]["Status"], "Enabled")
        self.assertTrue(BUCKET["LifecycleConfiguration"]["Rules"][0]["NoncurrentVersionExpiration"]["NoncurrentDays"] > 0)

    def test_name_follows_the_existing_convention(self):
        self.assertEqual(BUCKET["BucketName"], {"Sub": "cluenest-frontend-${Environment}-${AWS::AccountId}"})

    def test_prod_keeps_the_bucket(self):
        self.assertEqual(R["FrontendBucket"]["DeletionPolicy"], {"If": ["IsProd", "Retain", "Delete"]})
        self.assertEqual(R["FrontendBucket"]["UpdateReplacePolicy"], {"If": ["IsProd", "Retain", "Delete"]})

    def test_policy_allows_only_this_distribution_and_denies_plain_http(self):
        statements = R["FrontendBucketPolicy"]["Properties"]["PolicyDocument"]["Statement"]
        self.assertEqual(len(statements), 2)
        allow, deny = statements
        self.assertEqual((allow["Effect"], allow["Principal"], allow["Action"]), ("Allow", {"Service": "cloudfront.amazonaws.com"}, "s3:GetObject"))
        self.assertEqual(allow["Resource"], {"Sub": "${FrontendBucket.Arn}/*"})
        cond = allow["Condition"]["StringEquals"]["AWS:SourceArn"]["Sub"]
        self.assertIn("distribution/${FrontendDistribution}", cond)
        self.assertEqual((deny["Effect"], deny["Principal"], deny["Action"]), ("Deny", "*", "s3:*"))
        self.assertEqual(deny["Condition"], {"Bool": {"aws:SecureTransport": "false"}})
        text = str(statements)
        for forbidden in ("s3:ListBucket", "s3:PutObject", "s3:DeleteObject", "'Principal': '*', 'Action': 's3:GetObject'"):
            self.assertNotIn(forbidden, text)


class DistributionTests(unittest.TestCase):
    def test_entry_point_exists_and_is_the_default_root_object(self):
        self.assertTrue((FRONTEND / "index.html").is_file())
        self.assertEqual(DIST["DefaultRootObject"], "index.html")

    def test_s3_rest_origin_with_origin_access_control(self):
        origin = DIST["Origins"][0]
        self.assertEqual(len(DIST["Origins"]), 1)
        self.assertEqual(origin["DomainName"], {"GetAtt": "FrontendBucket.RegionalDomainName"})
        self.assertEqual(origin["OriginAccessControlId"], {"GetAtt": "FrontendOriginAccessControl.Id"})
        self.assertEqual(origin["S3OriginConfig"], {"OriginAccessIdentity": ""})        # empty with OAC
        self.assertNotIn("CustomOriginConfig", origin)                                   # not the website endpoint
        oac = R["FrontendOriginAccessControl"]["Properties"]["OriginAccessControlConfig"]
        self.assertEqual((oac["OriginAccessControlOriginType"], oac["SigningBehavior"], oac["SigningProtocol"]), ("s3", "always", "sigv4"))

    def test_https_only_cheap_and_read_only(self):
        b = DIST["DefaultCacheBehavior"]
        self.assertEqual(b["ViewerProtocolPolicy"], "redirect-to-https")
        self.assertEqual(b["AllowedMethods"], ["GET", "HEAD"])
        self.assertTrue(b["Compress"])
        self.assertEqual(DIST["PriceClass"], "PriceClass_100")
        self.assertTrue(DIST["Enabled"])
        self.assertNotIn("Aliases", DIST)                      # no custom domain, no certificate needed
        self.assertNotIn("ViewerCertificate", DIST)
        self.assertNotIn("Logging", DIST)
        self.assertNotIn("WebACLId", DIST)

    def test_caching_does_not_forward_the_sign_in_code(self):
        cfg = R["FrontendCachePolicy"]["Properties"]["CachePolicyConfig"]
        self.assertEqual(R["FrontendDistribution"]["Properties"]["DistributionConfig"]["DefaultCacheBehavior"]["CachePolicyId"], {"Ref": "FrontendCachePolicy"})
        p = cfg["ParametersInCacheKeyAndForwardedToOrigin"]
        self.assertEqual(p["QueryStringsConfig"], {"QueryStringBehavior": "none"})
        self.assertEqual(p["CookiesConfig"], {"CookieBehavior": "none"})
        self.assertEqual(p["HeadersConfig"], {"HeaderBehavior": "none"})
        self.assertTrue(p["EnableAcceptEncodingGzip"] and p["EnableAcceptEncodingBrotli"])
        self.assertEqual((cfg["MinTTL"], cfg["DefaultTTL"], cfg["MaxTTL"]), (0, 300, 86400))

    def test_security_headers_policy_is_the_aws_managed_one(self):
        self.assertEqual(DIST["DefaultCacheBehavior"]["ResponseHeadersPolicyId"], "67f7725c-6f97-4210-82d7-5512b31e9d03")

    def test_missing_files_open_the_app(self):
        errors = {e["ErrorCode"]: e for e in DIST["CustomErrorResponses"]}
        self.assertEqual(set(errors), {403, 404})
        for e in errors.values():
            self.assertEqual((e["ResponseCode"], e["ResponsePagePath"]), (200, "/index.html"))
            self.assertLessEqual(e["ErrorCachingMinTTL"], 60)

    def test_the_frontend_uses_hash_routes_so_refresh_works(self):
        nav = (FRONTEND / "js" / "navigation.js").read_text(encoding="utf-8")
        self.assertIn("location.hash", nav)
        self.assertNotIn("pushState", nav)


class CognitoAndApiTests(unittest.TestCase):
    CLIENT = R["UserPoolClient"]["Properties"]

    def test_localhost_urls_are_kept_and_the_cloudfront_url_is_added(self):
        for key, param in (("CallbackURLs", "FrontendCallbackUrl"), ("LogoutURLs", "FrontendLogoutUrl")):
            self.assertEqual(self.CLIENT[key], [{"Ref": param}, {"Sub": "https://${FrontendDistribution.DomainName}/"}])
        params = DATA["Parameters"]
        self.assertEqual(params["FrontendCallbackUrl"]["Default"], "http://localhost:5500/")
        self.assertEqual(params["FrontendLogoutUrl"]["Default"], "http://localhost:5500/")

    def test_oauth_settings_are_unchanged(self):
        c = self.CLIENT
        self.assertEqual(c["AllowedOAuthFlows"], ["code"])
        self.assertEqual(c["AllowedOAuthScopes"], ["openid", "email", "profile", "cluenest-api/read", "cluenest-api/write"])
        self.assertIs(c["GenerateSecret"], False)
        self.assertIs(c["AllowedOAuthFlowsUserPoolClient"], True)
        self.assertEqual(c["SupportedIdentityProviders"], ["COGNITO"])
        self.assertEqual(R["UserPoolClient"]["DependsOn"], "UserPoolResourceServer")

    def test_api_cors_allows_localhost_and_the_hosted_site_only(self):
        origins = R["HttpApi"]["Properties"]["CorsConfiguration"]["AllowOrigins"]
        self.assertEqual(len(origins), 2)
        self.assertEqual(origins[1], {"Sub": "https://${FrontendDistribution.DomainName}"})
        self.assertNotIn("*", str(origins))
        self.assertEqual(R["HttpApi"]["Properties"]["CorsConfiguration"]["AllowHeaders"], ["authorization", "content-type"])
        self.assertNotIn("AllowCredentials", R["HttpApi"]["Properties"]["CorsConfiguration"])

    def test_routes_and_authorizer_untouched(self):
        routes = {n: r for n, r in R.items() if r["Type"] == "AWS::ApiGatewayV2::Route"}
        self.assertEqual(len(routes), 20)
        for r in routes.values():
            self.assertEqual(r["Properties"]["AuthorizationType"], "JWT")
            self.assertTrue(r["Properties"]["AuthorizationScopes"])


class TemplateIntegrityTests(unittest.TestCase):
    def test_no_duplicate_keys_anywhere(self):
        yaml.load(TEXT, Loader=_DuplicateKeyLoader)       # raises on a duplicate logical ID, parameter, output or property

    def test_new_outputs_exist(self):
        out = DATA["Outputs"]
        self.assertEqual(out["FrontendBucketName"]["Value"], {"Ref": "FrontendBucket"})
        self.assertEqual(out["FrontendDistributionId"]["Value"], {"Ref": "FrontendDistribution"})
        self.assertEqual(out["FrontendUrl"]["Value"], {"Sub": "https://${FrontendDistribution.DomainName}/"})

    def test_every_reference_resolves(self):
        known = set(R) | set(DATA["Parameters"]) | {"AWS::NoValue"}
        for name, res in R.items():
            for ref in references(res):
                self.assertIn(ref, known, "%s refers to unknown %s" % (name, ref))

    def test_no_circular_dependencies(self):
        graph = {}
        for name, res in R.items():
            deps = {r for r in references(res) if r in R}
            dep_on = res.get("DependsOn", [])
            deps.update([dep_on] if isinstance(dep_on, str) else dep_on)
            graph[name] = deps
        state = {}

        def visit(node, path):
            if state.get(node) == "done":
                return
            self.assertNotEqual(state.get(node), "open", "circular dependency: " + " -> ".join(path + [node]))
            state[node] = "open"
            for dep in graph[node]:
                visit(dep, path + [node])
            state[node] = "done"
        for node in graph:
            visit(node, [])

    def test_the_distribution_does_not_depend_on_cognito_or_the_api(self):
        deps = {r for r in references(R["FrontendDistribution"]) if r in R}
        self.assertEqual(deps, {"FrontendBucket", "FrontendOriginAccessControl", "FrontendCachePolicy"})

    def test_backend_resources_are_all_still_present(self):
        for name in ("LambdaExecutionRole", "LambdaDynamoDBPolicy", "ClueNestTable", "AppliancesFunction", "TroubleshootFunction",
                     "MaintenanceFunction", "RepairHistoryFunction", "TechnicianSearchFunction", "TechnicianSearchRole",
                     "GooglePlacesSecret", "UserPool", "UserPoolClient", "UserPoolDomain", "UserPoolResourceServer",
                     "HttpApi", "JwtAuthorizer", "ApiStage", "ApiAccessLogGroup"):
            self.assertIn(name, R)
        self.assertEqual(sum(1 for r in R.values() if r["Type"] == "AWS::Cognito::UserPool"), 1)
        self.assertEqual(sum(1 for r in R.values() if r["Type"] == "AWS::Cognito::UserPoolClient"), 1)
        self.assertEqual(sum(1 for r in R.values() if r["Type"] == "AWS::ApiGatewayV2::Api"), 1)

    def test_hosting_resources_were_added_and_none_removed(self):
        before = yaml.load(Path(__import__("os").environ.get("HOSTING_TEMPLATE_BEFORE", "")).read_text(encoding="utf-8"), Loader=_Loader) \
            if __import__("os").environ.get("HOSTING_TEMPLATE_BEFORE") else None
        if before is None:
            self.skipTest("set HOSTING_TEMPLATE_BEFORE to the template from before the hosting step to compare")
        added = set(R) - set(before["Resources"])
        hosting = {"FrontendBucket", "FrontendBucketPolicy", "FrontendOriginAccessControl", "FrontendCachePolicy", "FrontendDistribution"}
        self.assertTrue(hosting <= added)                       # later steps may add more, but never fewer
        self.assertTrue(all(n.startswith(("Frontend", "MaintenanceReminder", "NotificationPreferences")) for n in added), added)
        self.assertEqual(set(before["Resources"]) - set(R), set())


if __name__ == "__main__":
    unittest.main(verbosity=2)
