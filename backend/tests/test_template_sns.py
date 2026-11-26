"""Checks on the Amazon SNS maintenance e-mail resources in cluenest-infrastructure.yaml.
Run from the project root (needs PyYAML):   python -m unittest discover -s backend/tests -v
Set SNS_TEMPLATE_BEFORE to a copy of the previous template to also prove that nothing existing changed
(apart from the intended edits listed below). They read the template and source only. Nothing contacts AWS.
"""
import os
import re
import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "cloudformation" / "cluenest-infrastructure.yaml"
SRC = ROOT / "lambda" / "src"
NEW = {"NotificationPreferencesRole", "NotificationPreferencesLogGroup", "NotificationPreferencesFunction", "NotificationPreferencesIntegration",
       "NotificationPreferencesGetRoute", "NotificationPreferencesPutRoute", "NotificationPreferencesInvokePermission"}
CHANGED = {"ClueNestTable", "MaintenanceReminderRole", "MaintenanceReminderFunction", "ApiStage"}


class _Loader(yaml.SafeLoader):
    pass


def _tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return {suffix: loader.construct_scalar(node)}
    if isinstance(node, yaml.SequenceNode):
        return {suffix: loader.construct_sequence(node, deep=True)}
    return {suffix: loader.construct_mapping(node, deep=True)}


_Loader.add_multi_constructor("!", _tag)
DATA = yaml.load(TEMPLATE.read_text(encoding="utf-8"), Loader=_Loader)
R = DATA["Resources"]
PREFS_ROLE = R["NotificationPreferencesRole"]["Properties"]
PREFS_FN = R["NotificationPreferencesFunction"]["Properties"]
REM_ROLE = R["MaintenanceReminderRole"]["Properties"]
REM_FN = R["MaintenanceReminderFunction"]["Properties"]
TOPIC_ARN = {"Sub": "arn:${AWS::Partition}:sns:${AWS::Region}:${AWS::AccountId}:ClueNestReminders-${Environment}-*"}
PREFIX = {"Sub": "arn:${AWS::Partition}:sns:${AWS::Region}:${AWS::AccountId}:ClueNestReminders-${Environment}-"}


def statements(role):
    return {s["Sid"]: s for s in role["Policies"][0]["PolicyDocument"]["Statement"]}


def allowed_attributes(statement):
    return set(statement["Condition"]["ForAllValues:StringEquals"]["dynamodb:Attributes"])


def source_attrs(filename, prefix):
    return set(re.findall(r"\b%s_[A-Za-z]+\b" % prefix, (SRC / filename).read_text(encoding="utf-8")))


class TopicDesignTests(unittest.TestCase):
    def test_there_is_no_shared_topic_and_no_filter_policy_anywhere(self):
        types = {r["Type"] for r in R.values()}
        for forbidden in ("AWS::SNS::Topic", "AWS::SNS::Subscription", "AWS::SNS::TopicPolicy", "AWS::SES::EmailIdentity", "AWS::SQS::Queue"):
            self.assertNotIn(forbidden, types)
        self.assertNotIn("FilterPolicy", Path(TEMPLATE).read_text(encoding="utf-8"))

    def test_every_sns_permission_is_limited_to_the_per_user_topic_names(self):
        for role in (PREFS_ROLE, REM_ROLE):
            for sid, s in statements(role).items():
                if any(a.startswith("sns:") for a in s["Action"]):
                    self.assertEqual(s["Resource"], TOPIC_ARN, sid)
                    self.assertTrue(all(a.startswith("sns:") for a in s["Action"]), sid)

    def test_the_two_environment_prefixes_are_the_same_and_end_with_a_dash(self):
        self.assertEqual(PREFS_FN["Environment"]["Variables"]["TOPIC_ARN_PREFIX"], PREFIX)
        self.assertEqual(REM_FN["Environment"]["Variables"]["TOPIC_ARN_PREFIX"], PREFIX)
        self.assertTrue(PREFIX["Sub"].endswith("-"))

    def test_the_stack_cannot_send_to_any_other_topic_or_service(self):
        text = str(R)
        for forbidden in ("sns:Publish', 'sns:Subscribe", "sns:*", "ses:", "sns:ConfirmSubscription", "sns:Unsubscribe"):
            self.assertNotIn(forbidden, text)


class PreferencesRoleTests(unittest.TestCase):
    def test_only_logging_and_three_scoped_statements(self):
        self.assertEqual(PREFS_ROLE["ManagedPolicyArns"], [{"Sub": "arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"}])
        s = statements(PREFS_ROLE)
        self.assertEqual(set(s), {"SettingItemAttributesOnly", "PerUserReminderTopicsOnly", "ReadOneUsersVerifiedEmail"})
        self.assertEqual(sorted(s["PerUserReminderTopicsOnly"]["Action"]),
                         ["sns:CreateTopic", "sns:DeleteTopic", "sns:ListSubscriptionsByTopic", "sns:SetTopicAttributes", "sns:Subscribe"])
        self.assertEqual(s["ReadOneUsersVerifiedEmail"]["Action"], ["cognito-idp:AdminGetUser"])
        self.assertEqual(s["ReadOneUsersVerifiedEmail"]["Resource"], {"GetAtt": "UserPool.Arn"})        # this pool only, read only
        self.assertNotIn("Publish", str(s))                                                              # the API function can never send mail
        for sid, st in s.items():
            self.assertEqual(st["Effect"], "Allow")
            self.assertNotEqual(st["Resource"], "*", sid)

    def test_it_can_touch_only_the_setting_attributes(self):
        st = statements(PREFS_ROLE)["SettingItemAttributesOnly"]
        self.assertEqual(sorted(st["Action"]), ["dynamodb:GetItem", "dynamodb:UpdateItem"])         # no Put, Delete, Query or Scan
        self.assertEqual(st["Resource"], {"GetAtt": "ClueNestTable.Arn"})
        self.assertEqual(st["Condition"]["StringEqualsIfExists"], {"dynamodb:Select": "SPECIFIC_ATTRIBUTES"})
        allowed = allowed_attributes(st)
        self.assertEqual({a for a in allowed if a.startswith("p_")}, source_attrs("notification_preferences.py", "p") | {"p_type", "p_userId"})
        self.assertTrue(all(a in ("PK", "SK") or a.startswith("p_") for a in allowed))                # no reminder attribute (taskName, dueDate, status ...)

    def test_the_function_settings(self):
        self.assertEqual(PREFS_FN["Handler"], "notification_preferences.handler")
        self.assertEqual(PREFS_FN["Role"], {"GetAtt": "NotificationPreferencesRole.Arn"})
        self.assertEqual((PREFS_FN["Runtime"], PREFS_FN["Architectures"]), ("python3.12", ["arm64"]))
        self.assertEqual(PREFS_FN["Code"], {"S3Bucket": {"Ref": "LambdaCodeBucket"}, "S3Key": {"Ref": "LambdaCodeKey"}})
        self.assertEqual(set(PREFS_FN["Environment"]["Variables"]), {"TABLE_NAME", "USER_POOL_ID", "TOPIC_ARN_PREFIX"})
        self.assertEqual(PREFS_FN["Environment"]["Variables"]["USER_POOL_ID"], {"Ref": "UserPool"})
        self.assertEqual(R["NotificationPreferencesLogGroup"]["Properties"]["LogGroupName"], {"Sub": "/aws/lambda/ClueNestNotificationPreferences-${Environment}"})
        self.assertEqual(R["NotificationPreferencesLogGroup"]["Properties"]["RetentionInDays"], {"If": ["IsProd", 90, 30]})

    def test_no_other_function_uses_this_role_and_it_is_not_the_shared_role(self):
        users = [n for n, r in R.items() if r["Type"] == "AWS::Lambda::Function" and r["Properties"]["Role"] == {"GetAtt": "NotificationPreferencesRole.Arn"}]
        self.assertEqual(users, ["NotificationPreferencesFunction"])
        self.assertNotIn("sns:", str(R["LambdaExecutionRole"]) + str(R["LambdaDynamoDBPolicy"]) + str(R["TechnicianSearchRole"]))


class RoutesTests(unittest.TestCase):
    def test_get_needs_the_read_scope_and_put_needs_the_write_scope_through_the_same_authorizer(self):
        get, put = R["NotificationPreferencesGetRoute"]["Properties"], R["NotificationPreferencesPutRoute"]["Properties"]
        self.assertEqual((get["RouteKey"], get["AuthorizationScopes"]), ("GET /notifications/preferences", ["cluenest-api/read"]))
        self.assertEqual((put["RouteKey"], put["AuthorizationScopes"]), ("PUT /notifications/preferences", ["cluenest-api/write"]))
        for r in (get, put):
            self.assertEqual((r["AuthorizationType"], r["AuthorizerId"]), ("JWT", {"Ref": "JwtAuthorizer"}))
            self.assertEqual(r["Target"], {"Sub": "integrations/${NotificationPreferencesIntegration}"})

    def test_invoke_permission_is_for_this_path_only(self):
        p = R["NotificationPreferencesInvokePermission"]["Properties"]
        self.assertEqual(p["Principal"], "apigateway.amazonaws.com")
        self.assertEqual(p["FunctionName"], {"Ref": "NotificationPreferencesFunction"})
        self.assertTrue(p["SourceArn"]["Sub"].endswith("/${Environment}/*/notifications/preferences"))

    def test_the_stage_waits_for_the_new_routes(self):
        depends = R["ApiStage"]["DependsOn"]
        self.assertIn("NotificationPreferencesGetRoute", depends)
        self.assertIn("NotificationPreferencesPutRoute", depends)


class ReminderRoleTests(unittest.TestCase):
    def test_the_existing_scan_statement_is_unchanged_and_two_scoped_ones_are_added(self):
        s = statements(REM_ROLE)
        self.assertEqual(set(s), {"ScanTheClueNestTableReadOnly", "LedgerAndOptInOnly", "PublishToPerUserTopicsOnly"})
        self.assertEqual(s["ScanTheClueNestTableReadOnly"]["Action"], ["dynamodb:Scan"])
        self.assertEqual(sorted(s["PublishToPerUserTopicsOnly"]["Action"]), ["sns:ListSubscriptionsByTopic", "sns:Publish"])
        self.assertEqual(sorted(s["LedgerAndOptInOnly"]["Action"]), ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:UpdateItem"])   # never Put or Delete

    def test_the_ledger_attribute_list_matches_the_code_exactly(self):
        st = statements(REM_ROLE)["LedgerAndOptInOnly"]
        allowed = allowed_attributes(st)
        in_code = source_attrs("reminder_delivery.py", "n")
        self.assertEqual({a for a in allowed if a.startswith("n_")}, in_code)                   # nothing the code does not use, nothing missing
        self.assertEqual({a for a in allowed if a.startswith("p_")}, {"p_maintenanceEmail"})     # it can read only the opt-in flag of the setting
        self.assertEqual(allowed - {a for a in allowed if a[:2] in ("n_", "p_")}, {"PK", "SK"})
        self.assertEqual(st["Condition"]["StringEqualsIfExists"], {"dynamodb:Select": "SPECIFIC_ATTRIBUTES"})
        self.assertIn("p_maintenanceEmail", (SRC / "reminder_delivery.py").read_text(encoding="utf-8"))

    def test_no_reminder_attribute_can_be_changed(self):
        allowed = allowed_attributes(statements(REM_ROLE)["LedgerAndOptInOnly"])
        for reminder_attr in ("taskName", "dueDate", "status", "applianceName", "userId", "entityType", "id", "notes", "repeat", "seriesId"):
            self.assertNotIn(reminder_attr, allowed)

    def test_cognito_is_not_needed_and_not_granted(self):
        self.assertNotIn("cognito", str(REM_ROLE))
        self.assertNotIn("ses:", str(REM_ROLE))

    def test_function_settings(self):
        v = REM_FN["Environment"]["Variables"]
        self.assertEqual(v["APP_URL"], {"Sub": "https://${FrontendDistribution.DomainName}/"})
        self.assertEqual(v["TABLE_NAME"], {"Ref": "ClueNestTable"})
        self.assertEqual((REM_FN["Timeout"], REM_FN["MemorySize"]), (300, 256))
        self.assertEqual(R["MaintenanceReminderRule"]["Properties"]["ScheduleExpression"], "cron(0 12 * * ? *)")      # the same daily rule is reused
        self.assertEqual(sum(1 for r in R.values() if r["Type"] == "AWS::Events::Rule"), 1)


class TableTests(unittest.TestCase):
    def test_ttl_only_on_the_ledger_attribute(self):
        t = R["ClueNestTable"]["Properties"]
        self.assertEqual(t["TimeToLiveSpecification"], {"AttributeName": "n_expiresAt", "Enabled": True})
        self.assertIn("n_expiresAt", source_attrs("reminder_delivery.py", "n"))
        for other in ("expiresAt", "ttl", "TTL"):
            self.assertNotIn(other, str(t["AttributeDefinitions"]))
        self.assertEqual(t["KeySchema"], [{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}])
        self.assertNotIn("GlobalSecondaryIndexes", t)                                            # no index added

    def test_outputs(self):
        self.assertEqual(DATA["Outputs"]["NotificationPreferencesFunctionName"]["Value"], {"Ref": "NotificationPreferencesFunction"})


class ScopeTests(unittest.TestCase):
    def test_twenty_authorized_routes_and_bedrock_still_off(self):
        routes = [r for r in R.values() if r["Type"] == "AWS::ApiGatewayV2::Route"]
        self.assertEqual(len(routes), 20)
        self.assertTrue(all(r["Properties"]["AuthorizationType"] == "JWT" and r["Properties"]["AuthorizationScopes"] for r in routes))
        self.assertEqual(DATA["Parameters"]["BedrockModelId"]["Default"], "")
        self.assertEqual(len(DATA["Parameters"]), 8)                                              # no new parameter

    @unittest.skipUnless(os.environ.get("SNS_TEMPLATE_BEFORE"), "set SNS_TEMPLATE_BEFORE to compare with the previous template")
    def test_only_the_intended_resources_changed(self):
        before = yaml.load(Path(os.environ["SNS_TEMPLATE_BEFORE"]).read_text(encoding="utf-8"), Loader=_Loader)
        self.assertEqual(set(R) - set(before["Resources"]), NEW)
        self.assertEqual(set(before["Resources"]) - set(R), set())
        changed = {n for n, r in before["Resources"].items() if R[n] != r}
        self.assertEqual(changed, CHANGED)
        self.assertEqual(DATA["Parameters"], before["Parameters"])
        self.assertEqual(DATA["Conditions"], before["Conditions"])
        self.assertEqual(set(DATA["Outputs"]) - set(before["Outputs"]), {"NotificationPreferencesFunctionName"})
        # the table change is the TTL and nothing else
        old_t, new_t = before["Resources"]["ClueNestTable"], dict(R["ClueNestTable"])
        new_props = {k: v for k, v in new_t["Properties"].items() if k != "TimeToLiveSpecification"}
        self.assertEqual(new_props, old_t["Properties"])
        # the stage change is two more routes in DependsOn
        old_s, new_s = before["Resources"]["ApiStage"], R["ApiStage"]
        self.assertEqual(set(new_s["DependsOn"]) - set(old_s["DependsOn"]), {"NotificationPreferencesGetRoute", "NotificationPreferencesPutRoute"})
        self.assertEqual(new_s["Properties"], old_s["Properties"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
