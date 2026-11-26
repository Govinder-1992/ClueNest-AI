"""Checks on the EventBridge daily maintenance reminder resources in cluenest-infrastructure.yaml.
Run from the project root (needs PyYAML):   python -m unittest discover -s backend/tests -v
Set EVENTBRIDGE_TEMPLATE_BEFORE to a copy of the previous template to also prove that nothing existing changed.
They read the template only. Nothing contacts AWS.
"""
import os
import re
import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "cloudformation" / "cluenest-infrastructure.yaml"
NEW = {"MaintenanceReminderRole", "MaintenanceReminderLogGroup", "MaintenanceReminderFunction",
       "MaintenanceReminderRule", "MaintenanceReminderInvokePermission"}


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
FN, ROLE, RULE, PERM, LOG = (R[n] for n in ("MaintenanceReminderFunction", "MaintenanceReminderRole", "MaintenanceReminderRule",
                                            "MaintenanceReminderInvokePermission", "MaintenanceReminderLogGroup"))


def mentions(node, name):
    """True when a Ref, GetAtt or Sub anywhere inside node points at the resource called name."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "Ref" and v == name:
                return True
            if k == "GetAtt" and (v if isinstance(v, str) else v[0]).split(".")[0] == name:
                return True
            if k == "Sub" and re.search(r"\$\{%s[.}]" % re.escape(name), v if isinstance(v, str) else v[0]):
                return True
            if mentions(v, name):
                return True
    elif isinstance(node, list):
        return any(mentions(v, name) for v in node)
    return False


class ScheduleTests(unittest.TestCase):
    def test_one_enabled_daily_schedule_rule(self):
        p = RULE["Properties"]
        self.assertEqual(RULE["Type"], "AWS::Events::Rule")
        self.assertEqual(p["State"], "ENABLED")
        self.assertNotIn("EventPattern", p)
        self.assertEqual(sum(1 for r in R.values() if r["Type"] == "AWS::Events::Rule"), 1)
        expr = p["ScheduleExpression"]
        m = re.fullmatch(r"cron\((\d{1,2}) (\d{1,2}) \* \* \? \*\)", expr)       # every day: day-of-month *, month *, weekday ?, year *
        self.assertIsNotNone(m, expr)
        self.assertEqual((int(m.group(1)), int(m.group(2))), (0, 12))             # 12:00 UTC

    def test_the_rule_starts_exactly_one_target_with_limited_retries(self):
        targets = RULE["Properties"]["Targets"]
        self.assertEqual(len(targets), 1)
        t = targets[0]
        self.assertEqual(t["Arn"], {"GetAtt": "MaintenanceReminderFunction.Arn"})
        self.assertEqual(t["RetryPolicy"], {"MaximumRetryAttempts": 2, "MaximumEventAgeInSeconds": 3600})
        for forbidden in ("Input", "InputPath", "InputTransformer", "RoleArn", "HttpParameters", "KinesisParameters", "SqsParameters"):
            self.assertNotIn(forbidden, t)

    def test_only_this_rule_may_invoke_the_function(self):
        p = PERM["Properties"]
        self.assertEqual(PERM["Type"], "AWS::Lambda::Permission")
        self.assertEqual(p["Action"], "lambda:InvokeFunction")
        self.assertEqual(p["Principal"], "events.amazonaws.com")
        self.assertEqual(p["FunctionName"], {"Ref": "MaintenanceReminderFunction"})
        self.assertEqual(p["SourceArn"], {"GetAtt": "MaintenanceReminderRule.Arn"})      # not a wildcard, not another rule
        self.assertEqual(sum(1 for r in R.values() if r["Type"] == "AWS::Lambda::Permission" and r["Properties"]["Principal"] == "events.amazonaws.com"), 1)


class FunctionTests(unittest.TestCase):
    def test_function_settings(self):
        p = FN["Properties"]
        self.assertEqual(p["Handler"], "maintenance_reminders.handler")
        self.assertEqual((p["Runtime"], p["Architectures"]), ("python3.12", ["arm64"]))
        self.assertEqual(p["Role"], {"GetAtt": "MaintenanceReminderRole.Arn"})
        self.assertEqual(set(p["Environment"]["Variables"]), {"TABLE_NAME", "TOPIC_ARN_PREFIX", "APP_URL"})       # see test_template_sns.py
        self.assertEqual((p["Timeout"], p["MemorySize"]), (300, 256))
        self.assertEqual(p["Code"], {"S3Bucket": {"Ref": "LambdaCodeBucket"}, "S3Key": {"Ref": "LambdaCodeKey"}})   # same zip as the others
        self.assertEqual(FN["DependsOn"], "MaintenanceReminderLogGroup")
        self.assertEqual(p["FunctionName"], {"Sub": "ClueNestMaintenanceReminders-${Environment}"})

    def test_handler_exists_in_the_zip_sources(self):
        src = (ROOT / "lambda" / "src" / "maintenance_reminders.py").read_text(encoding="utf-8")
        self.assertRegex(src, r"(?m)^def handler\(event, context\):")

    def test_function_is_not_reachable_through_the_api(self):
        for name, res in R.items():
            if res["Type"] in ("AWS::ApiGatewayV2::Integration", "AWS::ApiGatewayV2::Route"):
                self.assertFalse(mentions(res, "MaintenanceReminderFunction"), name)
        invokers = [n for n, r in R.items() if r["Type"] == "AWS::Lambda::Permission" and mentions(r, "MaintenanceReminderFunction")]
        self.assertEqual(invokers, ["MaintenanceReminderInvokePermission"])

    def test_log_group_matches_the_function_and_expires(self):
        p = LOG["Properties"]
        self.assertEqual(p["LogGroupName"], {"Sub": "/aws/lambda/ClueNestMaintenanceReminders-${Environment}"})
        self.assertEqual(p["RetentionInDays"], {"If": ["IsProd", 90, 30]})
        self.assertEqual(LOG["DeletionPolicy"], {"If": ["IsProd", "Retain", "Delete"]})


class IamTests(unittest.TestCase):
    def test_role_is_lambda_only_with_logging_and_one_read_only_statement(self):
        p = ROLE["Properties"]
        trust = p["AssumeRolePolicyDocument"]["Statement"]
        self.assertEqual(len(trust), 1)
        self.assertEqual((trust[0]["Principal"], trust[0]["Action"]), ({"Service": "lambda.amazonaws.com"}, "sts:AssumeRole"))
        self.assertEqual(p["ManagedPolicyArns"], [{"Sub": "arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"}])
        self.assertEqual(len(p["Policies"]), 1)
        statements = p["Policies"][0]["PolicyDocument"]["Statement"]
        scan = statements[0]                                                          # the original statement is unchanged
        self.assertEqual((scan["Effect"], scan["Action"]), ("Allow", ["dynamodb:Scan"]))
        self.assertEqual(scan["Resource"], {"GetAtt": "ClueNestTable.Arn"})             # this table only, no index, no wildcard
        self.assertEqual(len(statements), 3)                                          # plus the SNS step (see test_template_sns.py)

    def test_the_shared_role_still_cannot_scan(self):
        policy = R["LambdaDynamoDBPolicy"]["Properties"]["PolicyDocument"]["Statement"]
        self.assertEqual(sorted(policy[0]["Action"]), ["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"])
        self.assertNotIn("Scan", str(R["LambdaExecutionRole"]) + str(R["LambdaDynamoDBPolicy"]) + str(R.get("BedrockInvokePolicy", "")))

    def test_no_function_other_than_the_reminder_check_uses_the_new_role(self):
        users = [n for n, r in R.items() if r["Type"] == "AWS::Lambda::Function" and mentions(r["Properties"]["Role"], "MaintenanceReminderRole")]
        self.assertEqual(users, ["MaintenanceReminderFunction"])


class ScopeTests(unittest.TestCase):
    def test_no_notification_or_other_new_services(self):
        types = {r["Type"] for r in R.values()}
        for forbidden in ("AWS::SNS::Topic", "AWS::SNS::Subscription", "AWS::SES::EmailIdentity", "AWS::SQS::Queue",
                          "AWS::Scheduler::Schedule", "AWS::DynamoDB::GlobalTable"):
            self.assertNotIn(forbidden, types)
        self.assertEqual(sum(1 for r in R.values() if r["Type"] == "AWS::DynamoDB::Table"), 1)

    def test_outputs(self):
        out = DATA["Outputs"]
        self.assertEqual(out["MaintenanceReminderFunctionName"]["Value"], {"Ref": "MaintenanceReminderFunction"})
        self.assertEqual(out["MaintenanceReminderRuleName"]["Value"], {"Ref": "MaintenanceReminderRule"})

    def test_bedrock_stays_off_and_parameters_unchanged(self):
        self.assertEqual(DATA["Parameters"]["BedrockModelId"]["Default"], "")
        self.assertIn("HasBedrockModel", DATA["Conditions"])
        self.assertEqual(len(DATA["Parameters"]), 8)

    def test_api_routes_unchanged(self):
        routes = [r for r in R.values() if r["Type"] == "AWS::ApiGatewayV2::Route"]
        self.assertEqual(len(routes), 20)
        for r in routes:
            self.assertEqual(r["Properties"]["AuthorizationType"], "JWT")

    @unittest.skipUnless(os.environ.get("EVENTBRIDGE_TEMPLATE_BEFORE"), "set EVENTBRIDGE_TEMPLATE_BEFORE to compare with the previous template")
    def test_nothing_existing_changed_and_exactly_five_resources_added(self):
        before = yaml.load(Path(os.environ["EVENTBRIDGE_TEMPLATE_BEFORE"]).read_text(encoding="utf-8"), Loader=_Loader)
        self.assertEqual(set(R) - set(before["Resources"]), NEW)
        self.assertEqual(set(before["Resources"]) - set(R), set())
        for name, res in before["Resources"].items():
            self.assertEqual(R[name], res, name + " changed")                          # every existing resource is identical
        self.assertEqual(DATA["Parameters"], before["Parameters"])
        self.assertEqual(DATA["Conditions"], before["Conditions"])
        self.assertEqual(set(DATA["Outputs"]) - set(before["Outputs"]), {"MaintenanceReminderFunctionName", "MaintenanceReminderRuleName"})
        for name, out in before["Outputs"].items():
            self.assertEqual(DATA["Outputs"][name], out, name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
