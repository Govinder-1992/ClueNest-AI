# ClueNest AI Backend

The backend is a serverless AWS application defined as infrastructure as code with CloudFormation.

**All AWS infrastructure lives in ONE CloudFormation template, deployed as ONE stack per environment.**
It grows one AWS service at a time.

**Status: the `dev` stack `cluenest-infrastructure-dev` is deployed in `us-east-1`. It was created from this template on 2026-11-21 and has been updated twice since, with Cognito and then API Gateway. It currently has 42 resources: the IAM role and policy, the DynamoDB table, 5 Lambda functions, the Cognito user pool and app client, and the HTTP API with its authorizer, 5 integrations, 18 routes, stage, access log and 5 invoke permissions. The API is live and enforces Cognito sign-in on every route, but no one can sign in through a browser yet (no Cognito hosted-UI domain, no frontend login code).**

Region used throughout: `us-east-1`.

| Step | Service | Status |
|------|---------|--------|
| 1 | IAM (execution role) | Deployed to `dev`. |
| 2 | DynamoDB (table) | Deployed to `dev`. |
| 3 | Lambda (5 functions + DynamoDB permission) | Deployed to `dev`. All 5 have been invoked through the API (see "Validation results (API Gateway step)"). |
| 4 | Cognito (user pool + app client) | Deployed to `dev`. No users exist. No hosted-UI domain exists, so nobody can sign in through a browser yet. |
| 5 | API Gateway (HTTP API, JWT authorizer, routes, access log) | Deployed to `dev`. |
| 6 | Amazon Bedrock (AI troubleshooting) | Code and template written and tested with a fake client. **Not enabled in AWS**: the account has zero Bedrock quota. |
| 7 | Secrets Manager (Google Places key) | Deployed to `dev`. The key has been entered by hand (the value was never read by this project). |
| 8 | Google Places technician search | Deployed to `dev`. Verified with one real search (20 results). |
| 9 | Cognito hosted sign-in (domain + frontend login) | Domain deployed to `dev` (`cluenest-ai-dev`). Frontend code tested. No real sign-up has been tried yet (see "Cognito hosted sign-in section"). |
| 10 | Frontend hosting (S3 + CloudFront) | Deployed to `dev`. The 22 site files are uploaded and served at `https://d2z1tywpqu8eb2.cloudfront.net/`. A real sign-in on that address has not been tried yet (see "Frontend hosting section"). |
| 11 | EventBridge (daily maintenance reminder check) | Deployed to `dev`. Rule enabled, runs daily at 12:00 UTC. It only counts due reminders and sends nothing yet (see "EventBridge section"). |
| 12 | SNS maintenance e-mails (opt-in, per-user topics) | Backend deployed to `dev`. No topic, subscription or e-mail exists yet: nothing is sent until a user opts in and confirms. The Settings switch is uploaded and visible on the hosted site, but no user has opted in (see "SNS notifications section"). |
| 13 | Demo (mock) troubleshooting mode | Backend deployed to `dev` (MOCK is the effective mode, Bedrock is not called). The updated Troubleshooting screen is **not** uploaded to CloudFront yet (see "Demo troubleshooting section"). |

Only `dev` exists. `test` and `prod` have never been deployed.

## Files

| File | Purpose | Status |
|------|---------|--------|
| `cloudformation/cluenest-infrastructure.yaml` | **The one template.** IAM, DynamoDB, Lambda, Cognito and API Gateway today; every future service goes here. | Active. Validated. Deployed to `dev`. |
| `lambda/src/*.py` | Python 3.12 source of the Lambda functions. This folder is what gets zipped and deployed. | Active. Tested locally. Deployed to `dev`. |
| `lambda/tests/test_lambdas.py` | Tests for the Lambda code. Not deployed. | Active. 87 tests pass. |
| `cloudformation/iam.yaml` | Original Step 1 template. | **Superseded.** Reference only. Do not deploy. |
| `cloudformation/database.yaml` | Original Step 2 template. | **Superseded.** Reference only. Do not deploy. |

The two superseded files will be deleted once the master template has been verified. They have not been changed.

## One template, one stack

- **One file:** `cloudformation/cluenest-infrastructure.yaml`.
- **One stack per environment:** `cluenest-infrastructure-dev`, `-test`, `-prod`. They all use the same file and differ only in the `Environment` parameter. The environment goes into physical names (for example `ClueNestTable-dev`), so the stacks never collide.
- **One service at a time:** add a service, validate, preview the change set, then deploy.
- **Everything refers to everything inside the same file** with `!Ref` and `!GetAtt`. No cross-stack exports are needed, so none are defined.

## Template layout

The file is split into numbered banner sections, in this order:

| # | Section | Contents today |
|---|---------|----------------|
| 1 | `Parameters` | `Environment`, `LambdaCodeBucket`, `LambdaCodeKey`, `FrontendCallbackUrl`, `FrontendLogoutUrl` |
| 2 | `Conditions` | `IsProd` (true when `Environment` is `prod`) |
| 3 | IAM Resources (inside `Resources`) | `LambdaExecutionRole`, `LambdaDynamoDBPolicy` |
| 4 | DynamoDB Resources | `ClueNestTable` |
| 5 | Lambda Resources | 5 functions |
| 5b | Secrets Manager and technician role (next to the Lambda functions) | `GooglePlacesSecret`, `TechnicianSearchRole` |
| 6 | Cognito Resources | `UserPool`, `UserPoolClient` |
| 7 | API Gateway Resources | access log group, HTTP API, JWT authorizer, 5 integrations, 18 routes, stage, 5 invoke permissions |
| 8 | `Outputs` | role, table, function, Cognito and API values |

A comment block marks where future sections are added.

| Logical ID | Type | Physical name |
|------------|------|---------------|
| `LambdaExecutionRole` | `AWS::IAM::Role` | `ClueNestLambdaExecutionRole-<Environment>` |
| `LambdaDynamoDBPolicy` | `AWS::IAM::Policy` | `ClueNestLambdaDynamoDBAccess-<Environment>` |
| `ClueNestTable` | `AWS::DynamoDB::Table` | `ClueNestTable-<Environment>` |
| `AppliancesFunction` | `AWS::Lambda::Function` | `ClueNestAppliances-<Environment>` |
| `TroubleshootFunction` | `AWS::Lambda::Function` | `ClueNestTroubleshoot-<Environment>` |
| `MaintenanceFunction` | `AWS::Lambda::Function` | `ClueNestMaintenance-<Environment>` |
| `RepairHistoryFunction` | `AWS::Lambda::Function` | `ClueNestRepairHistory-<Environment>` |
| `TechnicianSearchFunction` | `AWS::Lambda::Function` | `ClueNestTechnicianSearch-<Environment>` |
| `TechnicianSearchRole` | `AWS::IAM::Role` | `ClueNestTechnicianSearchRole-<Environment>` |
| `GooglePlacesSecret` | `AWS::SecretsManager::Secret` | `cluenest/google-places/<Environment>` |
| `BedrockInvokePolicy` (only when `BedrockModelId` is set) | `AWS::IAM::Policy` | `ClueNestLambdaBedrockInvoke-<Environment>` |
| `UserPool` | `AWS::Cognito::UserPool` | `ClueNestUsers-<Environment>` |
| `UserPoolClient` | `AWS::Cognito::UserPoolClient` | `ClueNestWebClient-<Environment>` |
| `ApiAccessLogGroup` | `AWS::Logs::LogGroup` | `/aws/vendedlogs/apigateway/ClueNestApi-<Environment>` |
| `HttpApi` | `AWS::ApiGatewayV2::Api` | `ClueNestApi-<Environment>` |
| `JwtAuthorizer` | `AWS::ApiGatewayV2::Authorizer` | `ClueNestCognitoJwt-<Environment>` |
| `AppliancesIntegration`, `MaintenanceIntegration`, `RepairHistoryIntegration`, `TroubleshootIntegration`, `TechnicianSearchIntegration` | `AWS::ApiGatewayV2::Integration` | (one per function) |
| 18 routes, for example `AppliancesListRoute`, `MaintenanceCompleteRoute`, `TechnicianSearchRoute` | `AWS::ApiGatewayV2::Route` | `GET /appliances` and so on (see the route table) |
| `ApiStage` | `AWS::ApiGatewayV2::Stage` | `<Environment>` (so `dev`) |
| `AppliancesInvokePermission`, `MaintenanceInvokePermission`, `RepairHistoryInvokePermission`, `TroubleshootInvokePermission`, `TechnicianSearchInvokePermission` | `AWS::Lambda::Permission` | (one per function) |

Parameters:

| Parameter | Meaning |
|-----------|---------|
| `Environment` | `dev`, `test` or `prod` (default `dev`). Part of every physical name, the `Environment` tag and the `IsProd` condition. |
| `LambdaCodeBucket` | Name of an existing S3 bucket (same region) that holds the Lambda zip. Required, no default. The bucket is created outside this stack. |
| `LambdaCodeKey` | S3 key of the zip, ending in `.zip`. Required, no default. Use a new key for every build. |
| `FrontendCallbackUrl` | Where Cognito sends the browser after sign-in. Default `http://localhost:5500/`. Only `https://` URLs or `http://localhost` are accepted. |
| `FrontendLogoutUrl` | Where Cognito sends the browser after sign-out. Same rules and default. |
| `CognitoDomainPrefix` | First part of the Cognito sign-in domain, default `cluenest-ai` (the domain is `<prefix>-<Environment>`). |
| `BedrockModelId` | Bedrock model or inference profile ID for troubleshooting. Default empty = Bedrock off (no permission, no variable). |
| `BedrockBaseModelId` | Underlying foundation model ID when `BedrockModelId` is an inference profile. Default empty. |

Outputs (no `Export` names, because everything is in one stack): `LambdaExecutionRoleArn`, `LambdaExecutionRoleName`, `TableName`, `TableArn`, one `...FunctionArn` per function, `UserPoolId`, `UserPoolArn`, `UserPoolClientId`, `CognitoIssuerUrl`, and `ApiId`, `ApiBaseUrl`, `CorsAllowedOrigin`, `ApiAccessLogGroupName`, `GooglePlacesSecretArn`, `GooglePlacesSecretName`, `TechnicianSearchRoleArn` (and `BedrockModelIdInUse` when Bedrock is on). No output ever contains a secret value.

## Adding a future service

Planned services, to be added one at a time: S3, CloudWatch. Neither exists yet.

How to add one:

1. Add a new banner section for the service under `Resources`, below the existing ones, and renumber the later banners.
2. Give each resource a clear PascalCase logical ID that says what it is. Put the environment in the physical name with `!Sub ...-${Environment}`, never in the logical ID.
3. Reference other resources directly (for example `Role: !GetAtt LambdaExecutionRole.Arn`). CloudFormation then creates things in the right order. Add a `DependsOn` only when a resource must wait for something it does not reference.
4. Reuse `IsProd` for settings that differ in production. Add a new parameter only when a value really must be chosen at deploy time.
5. Add the values you will need to read later to `Outputs`, grouped under a comment for that service.
6. Tag every taggable resource with `Project`, `Environment` and `ManagedBy`.
7. Run `cfn-lint` and `validate-template`, then create a change set and read it before applying.

Rules to keep the single stack safe:

- **Never rename a logical ID after deployment.** CloudFormation treats a rename as "delete the old resource and create a new one".
- **Read every change set.** Look for `Replacement: True` or `Remove` on existing resources before you apply.
- **Give each new permission to specific resources.** No wildcard actions or resources.
- **Limits to remember:** at most 500 resources per stack. The template can be at most 51,200 bytes when passed directly and up to 1 MB if uploaded through S3. **This template is now about 35 KB, so it will probably cross the 51,200-byte limit within one or two more services.** When it does, add `--s3-bucket cluenest-ai-artifacts-<account id>` to the `aws cloudformation deploy` command (the CLI uploads the template for you) and keep using `--template-file`. If it ever approaches 1 MB, it can be split into nested stacks.

## IAM section

### The execution role

Every Lambda function runs as an IAM role, called its execution role. `LambdaExecutionRole` is shared by all ClueNest AI Lambda functions.

- **Trust policy (who can use the role):** only the AWS Lambda service (`lambda.amazonaws.com`) with `sts:AssumeRole`. Nobody else is listed.
  There is **no `Condition` block on purpose**. AWS documents the Lambda principal plus `sts:AssumeRole` as the required trust policy. Extra conditions such as `aws:SourceAccount` are a confused-deputy protection for some services, but I could not confirm that Lambda supplies them when assuming an execution role, and this cannot be tested without deploying. A condition Lambda does not satisfy would stop every function from starting. Lambda also only accepts an execution role from the same account as the function, and creating a function requires `iam:PassRole` on the role. If you want to add the condition later, test it in `dev` first.
- **Managed policy:** `AWSLambdaBasicExecutionRole`, which allows exactly `logs:CreateLogGroup`, `logs:CreateLogStream` and `logs:PutLogEvents`. Without it you cannot see function logs in CloudWatch.
- The role definition is unchanged from Step 1 except for its `Description` text, which now mentions the DynamoDB access.

### DynamoDB permission (added in Step 3)

The DynamoDB permission is a separate resource, `LambdaDynamoDBPolicy` (`AWS::IAM::Policy`), attached to the role. The role itself was not edited, so the policy is easy to review or remove.

| Allowed action | Why the code needs it |
|----------------|-----------------------|
| `dynamodb:GetItem` | Read one item (an appliance, reminder or repair record). |
| `dynamodb:Query` | List a user's items of one type. |
| `dynamodb:PutItem` | Create and replace items. A DynamoDB transaction made only of `Put` operations needs just this permission, per the AWS documentation. |
| `dynamodb:DeleteItem` | Delete items. |

- **Resource:** this table's ARN only (`!GetAtt ClueNestTable.Arn`). No wildcard resource. No index ARNs, because the table has no indexes.
- **Not allowed:** `Scan`, `UpdateItem`, batch operations, `ConditionCheckItem`, and every table or backup management action.
- **Checked three ways:** (1) a script compared the actions with every DynamoDB call in the code, and the two lists are identical, so the policy is both sufficient and minimal; (2) AWS's policy simulator allowed the four actions on the ClueNest table and denied all 32 other combinations I tried, including every action on a different table, on an index, and on the prod table; (3) the code was run against a DynamoDB emulator.
- **Confirmed against real AWS.** The policy and role exist in `dev` and match the template. The permissions have worked against real DynamoDB: a manual smoke test (list, create, delete) and then the full end-to-end test through the API created, read, updated, completed and deleted appliances, reminders and repair records. No `AccessDenied` appeared in any Lambda log.

### One shared role, or separate roles?

- **Four functions share `LambdaExecutionRole`.** They need the same DynamoDB actions on the same table. The technician-search function has its own role since the Secrets Manager step (see \"Secrets Manager section\").
- **Soon: separate roles will be safer.** The Bedrock step added `bedrock:InvokeModel` to this shared role (as requested), so every ClueNest function technically has it, though only the troubleshooting code uses it. A separate troubleshooting role would be tighter still. It is not done yet.
- Until then the effective permissions are the union of all functions' needs. Per function: Appliances, Maintenance and RepairHistory need `GetItem`, `Query`, `PutItem`, `DeleteItem`; Troubleshoot needs `GetItem`; TechnicianSearch needs none.

### What the role does NOT have

- No IAM users and no access keys anywhere in the template.
- No `AdministratorAccess`, no wildcard-action policies, no full-access managed policies.
- Bedrock permission is added in its own step (see "Bedrock section"). The daily reminder check has its own role (see "EventBridge section"). No S3 or SNS permissions yet.
- No credentials, keys or secrets in the template or the code.

## DynamoDB section

### Why one table

Every ClueNest record belongs to exactly one user, and every screen asks for "all of this user's X". So all record types live in one table, grouped by user. One `Query` reads a user's data.

### Keys

| Key | Attribute | Type | Value |
|-----|-----------|------|-------|
| Partition key | `PK` | String | `USER#<Cognito sub>` |
| Sort key | `SK` | String | `<TYPE>#<id>` |

- **Partition key = the user.** Every item of one user has the same `PK`, so a query returns that user's items and never anyone else's. The `sub` comes only from the verified token (see "Authentication and user isolation").
- **Sort key = record type plus ID.** The type prefix lets a `begins_with` query list one kind of record. IDs are random UUIDs created by the Lambda function and never change, so editing a record never changes its key.

### Record types

| Record type | Sort key pattern | Stored by | Main attributes |
|-------------|------------------|-----------|-----------------|
| Appliance | `APPLIANCE#<id>` | AppliancesFunction | name, type, brand, model, serialNumber, purchaseDate, purchasePriceCents, storeName, warrantyYears, warrantyExpiry (calculated by the server) |
| Maintenance reminder | `MAINTENANCE#<id>` | MaintenanceFunction | applianceId, appliance snapshot, taskName, description, dueDate, repeat, anchorDay, seriesId, status (`pending` or `completed`), completedDate, notes |
| Repair record | `REPAIR#<id>` | RepairHistoryFunction | applianceId, appliance snapshot, problem, repairDate, status (`completed`, `in_progress`, `not_repaired`, `cancelled`), company, costCents, additionalCents, notes |
| Troubleshooting session | `TROUBLESHOOT#<applianceId>#<sessionId>` | Nothing yet (the troubleshooting function does not save results) | Planned: category, description, errorCode, possibleCauses, recommendedSolutions, safetyWarnings, hazardDetected, mode |
| Technician quote | `QUOTE#<id>` | Nothing yet (no function in this step) | Planned: businessName, contact details, costs in cents, quoteDate, notes |

Every item also has `PK`, `SK`, `id`, `entityType` (for example `REPAIR`), `userId`, `createdAt` and `updatedAt`. These internal attributes (`PK`, `SK`, `userId`, `entityType`, `anchorDay`) are never returned by the API.

The appliance snapshot is a copy of the appliance's id, name, brand, model and type, kept on reminders and repair records so they stay readable on their own, even if the appliance is later deleted or renamed. This matches what the prototype frontend already does.

Example keys for one user:

```
PK = USER#4f1c9a52-0b7e-4d3a-9c21-7e5a8d1b6f30   SK = APPLIANCE#c2d8e1a4-5b6f-4a07-8e93-1d2c3b4a5f60
PK = USER#4f1c9a52-0b7e-4d3a-9c21-7e5a8d1b6f30   SK = MAINTENANCE#e0b4c7d2-...
PK = USER#4f1c9a52-0b7e-4d3a-9c21-7e5a8d1b6f30   SK = REPAIR#a3f5d9e1-...
PK = USER#4f1c9a52-0b7e-4d3a-9c21-7e5a8d1b6f30   SK = TROUBLESHOOT#c2d8e1a4-5b6f-4a07-8e93-1d2c3b4a5f60#7a91b3c5-...
```

### Secondary index: none

No index is created, on purpose. Every current screen asks only for the signed-in user's own items, which the sort-key prefix answers, and sorting a few dozen reminders by due date in Lambda costs nothing. A later notification feature that needs "every user's reminders due today" could add one global secondary index in a normal template update, with no table replacement. One possible design is a sparse index on the existing `status` and `dueDate` attributes. That is a sketch and is not part of the template. Local secondary indexes are the only kind that cannot be added later, and nothing here needs one.

### Table settings

| Setting | dev / test | prod |
|---------|------------|------|
| Billing | `PAY_PER_REQUEST` | `PAY_PER_REQUEST` |
| Encryption at rest | On, AWS managed key | On, AWS managed key |
| Point-in-time recovery | Off | On |
| Deletion protection | Off | On |
| `DeletionPolicy` / `UpdateReplacePolicy` | `Delete` | `Retain` |

- **Encryption:** `SSEType: KMS` with no key ID uses the AWS managed key `alias/aws/dynamodb`. There is no key to manage. Small AWS KMS request charges can apply. Callers should not need separate KMS permissions with this key (confirm during testing).
- **Deleting a dev or test stack deletes its table and all its data.** In prod, the table is kept if the stack is deleted, and deletion protection blocks deleting it until you switch the protection off on purpose.
- **Fixed table name:** CloudFormation will refuse any change that needs replacing the table (for example changing the keys). That protects the data. Changing keys means creating a new table and migrating.

## Lambda section

### Functions

All five functions use Python 3.12 on arm64, load the same zip, and run as `LambdaExecutionRole`. They differ only in their handler.

| Function | Handler | Memory / timeout | Environment variables | DynamoDB actions used |
|----------|---------|------------------|-----------------------|-----------------------|
| `ClueNestAppliances-<env>` | `appliances.handler` | 256 MB / 10 s | `TABLE_NAME` | GetItem, Query, PutItem, DeleteItem |
| `ClueNestTroubleshoot-<env>` | `troubleshoot.handler` | 256 MB / 10 s | `TABLE_NAME` | GetItem |
| `ClueNestMaintenance-<env>` | `maintenance.handler` | 256 MB / 10 s | `TABLE_NAME` | GetItem, Query, PutItem (also in a transaction), DeleteItem |
| `ClueNestRepairHistory-<env>` | `repair_history.handler` | 256 MB / 10 s | `TABLE_NAME` | GetItem, Query, PutItem, DeleteItem |
| `ClueNestTechnicianSearch-<env>` | `technician_search.handler` | 128 MB / 25 s (10 s until the Places change is deployed) | `GOOGLE_PLACES_SECRET_ARN` | `TechnicianSearchRole` (not the shared role) |

`TABLE_NAME` is set with `!Ref ClueNestTable`. The code reads no other environment variable. Every function waits (`DependsOn`) for `LambdaDynamoDBPolicy`, so the permissions exist before the function does.

What each function does (the route paths are listed in the API Gateway section):

| Function | Purpose | API operations |
|----------|---------|----------------|
| Appliances | The signed-in user's appliances | `GET /appliances`, `POST /appliances`, `GET /appliances/{id}`, `PUT /appliances/{id}`, `DELETE /appliances/{id}` |
| Troubleshoot | Safety rules first (gas, smoke or burning smell, sparks, exposed wiring, water near electrical parts: fixed stop-and-call-a-professional answer, no model call). Otherwise asks Amazon Bedrock through the Converse API. Never returns made-up guidance when Bedrock fails. See the Bedrock section. |
| Maintenance | Reminders, including repeats and "mark complete" | `GET /maintenance`, `POST /maintenance`, `GET/PUT/DELETE /maintenance/{id}`, `POST /maintenance/{id}/complete` |
| RepairHistory | Repair records | `GET /repair-history`, `POST /repair-history`, `GET/PUT/DELETE /repair-history/{id}` |
| TechnicianSearch | Searches Google Places (New) for appliance repair businesses near a location. See the "Technician search section". |

Not created as Lambda functions, on purpose:

- **Warranty checking and repair-versus-replace.** The frontend calculates both from appliance data it already has. They need no server data and no secrets, so a function would only duplicate the logic.
- **Technician quotes.** Not in this step's list. The table already supports them, and adding a function later follows the same pattern as RepairHistory.

### Behaviour that matters

- **Appliances:** the server always calculates `warrantyExpiry` from `purchaseDate` and `warrantyYears` (29 February plus one year becomes 28 February). Any expiry the client sends is ignored. `purchasePrice` arrives in dollars and is stored as whole cents (`purchasePriceCents`). Deleting an appliance removes only the appliance. Repair records and reminders are kept.
- **Maintenance:** a reminder is created `pending`. Only pending reminders can be edited or deleted; completed ones are history (409 otherwise). Completing one marks it `completed` with a date, and for a repeating reminder creates the next occurrence as a new item in the same transaction, so both happen or neither does. The next due date follows the original schedule and skips dates already passed. A 31st-of-the-month schedule does not drift. The next occurrence has an id derived from its series and due date, so a replayed request cannot create a duplicate. The API returns dates and status; whether a reminder is Upcoming or Overdue is decided by the app from the user's local date.
- **Repair history:** costs are whole cents (CAD). The repair date cannot be in the future or before the appliance was purchased. Filtering, sorting by other fields and expense totals are done by the app.
- **Dates:** the server uses UTC. Purchase and repair dates may be up to one day ahead of UTC so a user ahead of UTC can enter their own "today". A completion date sent by the client must be within one day of UTC today.
- **Reads are consistent**, so a record that was just saved appears in the next list call.
- **Lists** return everything for the user, up to 1000 items (`"truncated": true` if more exist).

### API contract between the functions and API Gateway

This is what the functions require. The API Gateway section below describes how it is now provided.

- **Event formats:** both API Gateway REST (payload 1.0) and HTTP API (payload 2.0) events work. The deployed API uses HTTP API with payload 2.0.
- **Path parameter:** every `{id}` route names its parameter exactly `id`.
- **Authorizer:** every route uses the Cognito authorizer. The functions read the user from `requestContext.authorizer.claims` (REST) or `requestContext.authorizer.jwt.claims` (HTTP API). Without a verified `sub` they answer 401, which is a second line of defence behind the authorizer.
- **Response format:** always JSON with `Content-Type: application/json` and `Cache-Control: no-store`. The functions add no CORS headers; API Gateway does.
- **Names are `id`**, matching what the frontend already reads.

Responses (examples):

```
POST /appliances  ->  201
{"appliance": {"id": "...", "name": "Kitchen Fridge", "type": "Refrigerator", "brand": "LG",
               "purchaseDate": "2024-01-10", "warrantyYears": 2, "warrantyExpiry": "2026-01-10",
               "purchasePrice": 499.99, "createdAt": "...", "updatedAt": "..."}}

GET /appliances   ->  200   {"appliances": [ ... newest first ], "count": 1, "truncated": false}
GET /maintenance  ->  200   {"reminders": [ ... earliest due first ], "count": 3, "truncated": false}
GET /repair-history -> 200  {"records": [ ... newest repair first ], "count": 2, "truncated": false}
POST /maintenance/{id}/complete -> 200   {"completed": {...}, "next": {...} or null}

Errors:  {"message": "Some fields are invalid. Please correct them and try again.",
          "code": "VALIDATION_ERROR", "fields": {"name": "This field is required."}}
```

| Status | Meaning |
|--------|---------|
| 200 / 201 | Success / created |
| 400 | Invalid body or field (`VALIDATION_ERROR`, `INVALID_BODY`, `APPLIANCE_NOT_FOUND` for a referenced appliance that is not the user's) |
| 401 | No verified user (`UNAUTHENTICATED`) |
| 404 | Not found, including another user's id and malformed ids (`NOT_FOUND`) |
| 405 | Method not supported |
| 409 | Conflict (`ALREADY_COMPLETED`, `CONFLICT`) |
| 413 | Body larger than 100 KB |
| 501 | Placeholder function or no Bedrock model set (`NOT_CONFIGURED`) |
| 503 | DynamoDB throttling (`BUSY`) |
| 500 | Anything unexpected (`INTERNAL_ERROR`), with no internal details |

Frontend compatibility (the frontend was not changed in this step):

- `GET /appliances` returns `{"appliances": [...]}` with `id`, which the existing `Api.getAppliances()` already understands. `POST /appliances` accepts exactly the payload the Add Appliance form sends.
- A failed troubleshooting call shows "Request failed (503): The AI service is busy right now..." (or similar) because the frontend appends the server's `message`.
- The frontend sends the raw token in the `Authorization` header with no `Bearer ` prefix. The deployed authorizer accepts that (tested), so no frontend change is needed for it.
- Maintenance, repair history and quotes still use browser storage in the frontend. Switching them to these endpoints is a separate frontend task.

### Authentication and user isolation

- The user ID is the Cognito `sub` from the claims API Gateway's authorizer has already verified. It is **never** read from the body, query string, path or headers. A test confirms a request with a forged `sub` in all of those places is rejected with 401.
- A `sub` must match `[A-Za-z0-9._:@-]{1,128}`. It cannot contain `#`, so it cannot change a DynamoDB key.
- Every key is built as `USER#<sub>` plus the type and id. A request for another user's id looks up a key that does not exist, so it returns 404. Tests cover this for appliances, reminders and repair records (read, update, delete, complete).
- Fields the client sends that the server owns (`PK`, `SK`, `userId`, `id`, `createdAt`, `entityType`, `warrantyExpiry`) are ignored.
- IDs in paths must be lowercase UUIDs, so they cannot inject key text.
- A reminder or repair record can only reference an appliance that belongs to the same user.
- This is enforced in code, not in IAM, because all functions share one role. DynamoDB cannot tell users apart from a shared role.

### Validation and errors

- The functions repeat the frontend's validation rules, because the server must never trust the browser. Every problem field is returned at once in `fields`.
- Text must be text, within its length, with no control characters. Dates must be real `YYYY-MM-DD` dates. Whole numbers must be integers (not strings, booleans or decimals). Money has at most 2 decimals and cannot be negative.
- Unexpected errors are logged to CloudWatch with a stack trace but the response only says something went wrong. Request bodies are never logged.

### Packaging and updating the stack

Inline code is limited to 4 KB, so the functions load a zip from S3. The bucket is a prerequisite you create yourself (S3 resources come in their own step). The zip is about 22 KB: the seven `.py` files in `lambda/src`, at the top level of the archive. `boto3` is already part of the Lambda Python runtime, so nothing else is packaged.

**Current `dev` deployment:** bucket `cluenest-ai-artifacts-<account id>`, key `lambda/cluenest-backend-20261121-222453.zip` (7 files, including `cluenest_secrets.py`). Commands run from the project root.

1. Choose the artifact bucket. A private, encrypted bucket named `cluenest-ai-artifacts-<account id>` already exists in `us-east-1`. It was found during a read-only check and holds older `lambda/cluenest-diagnose-*.zip` files from the earlier backend. If it is yours you can reuse it: the new keys (`lambda/cluenest-backend-<version>.zip`) do not clash with those files, and nothing here deletes or changes them. To use a new bucket instead, create it once (the name must be globally unique; new buckets block public access by default):

   ```powershell
   aws s3 mb s3://<your-unique-bucket-name> --region us-east-1
   ```

2. Build a zip and upload it with a new key for every build:

   ```powershell
   $version = Get-Date -Format "yyyyMMdd-HHmmss"
   python -c "import zipfile,glob,os,sys; z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED); [z.write(f, os.path.basename(f)) for f in sorted(glob.glob('backend/lambda/src/*.py'))]; z.close()" "cluenest-backend-$version.zip"
   aws s3 cp "cluenest-backend-$version.zip" "s3://<your-unique-bucket-name>/lambda/cluenest-backend-$version.zip"
   ```

3. Preview the stack change without applying it. Always pass every parameter, with the values the stack already has unless you mean to change them:

   ```powershell
   aws cloudformation deploy `
     --template-file backend/cloudformation/cluenest-infrastructure.yaml `
     --stack-name cluenest-infrastructure-dev `
     --parameter-overrides Environment=dev LambdaCodeBucket=<your-unique-bucket-name> LambdaCodeKey=lambda/cluenest-backend-$version.zip FrontendCallbackUrl=http://localhost:5500/ FrontendLogoutUrl=http://localhost:5500/ `
     --capabilities CAPABILITY_NAMED_IAM `
     --region us-east-1 `
     --no-execute-changeset
   ```

   The command prints a `describe-change-set` command. Run it and read the list. Every existing resource should show nothing, or only what you intended to change. Look for `Replacement: True` and `Remove`.

4. To apply, run the `aws cloudformation execute-change-set --change-set-name <the ARN it printed>` command, so exactly the reviewed change set runs. Then wait with `aws cloudformation wait stack-update-complete --stack-name cluenest-infrastructure-dev`. To ship new code later, build and upload a new zip with a new key and use the new `LambdaCodeKey`.

Notes:

- The zip is built with Python's `zipfile` so entries are flat and use forward slashes. I did not test other zip tools.
- The bucket must be in the same region as the stack. Deleting the stack does not delete the bucket or the zip files.
- Lambda creates each function's CloudWatch log group on first use, with no expiry. Log retention belongs to the CloudWatch step. Deleting the stack does not delete those log groups.
- Deleting the `dev` or `test` stack deletes its DynamoDB table and all data. The `prod` table is kept.

### Running the tests

The tests use an emulator (moto) and fake credentials, and cannot reach real AWS. Python 3.12 is recommended because it is the Lambda runtime version.

```powershell
python -m venv .venv
.venv\Scripts\pip install boto3 moto
.venv\Scripts\python -m unittest discover -s backend/lambda/tests -v
```

## Cognito section

Two resources, no others: `UserPool` (`ClueNestUsers-<Environment>`) and `UserPoolClient` (`ClueNestWebClient-<Environment>`). No identity pool, no identity provider, no domain, no users and no IAM changes were added. The Lambda role was not touched.

Values of the deployed `dev` stack (public identifiers, not secrets). They are also in the stack outputs:

| Value | Output name | `dev` |
|-------|-------------|-------|
| User pool ID | `UserPoolId` | `us-east-1_V3CRnV5wU` |
| App client ID | `UserPoolClientId` | `2o0tmubl9bksl35dpkobg3tcu1` |
| Issuer URL | `CognitoIssuerUrl` | `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_V3CRnV5wU` |
| User pool ARN | `UserPoolArn` | in the stack outputs |

Read them any time with:

```powershell
aws cloudformation describe-stacks --stack-name cluenest-infrastructure-dev --region us-east-1 --query "Stacks[0].Outputs"
```

### User pool settings

| Setting | Value |
|---------|-------|
| Sign-in name | Email address, not case sensitive |
| Sign-up | Self-service. Anyone can register. There is no administrator-only mode and no admin API in this template. |
| Collected at sign-up | Email and first name (`given_name`), both required |
| Email verification | A code is emailed at sign-up. Password reset works only through a verified email. |
| Changing an email later | The new address must be verified before it takes effect. |
| Password policy | At least 12 characters, with upper case, lower case, a number and a symbol |
| MFA, SMS, advanced security, Lambda triggers | Not configured |
| Email sender | Cognito's built-in sender (see limits below) |
| Deletion | `dev` and `test`: deleting the stack deletes the pool and all its users. `prod`: the pool is retained and protected against deletion. |
| Tags | `Project`, `Environment`, `ManagedBy` |

Passwords exist only inside Cognito. They are never written to DynamoDB, and the Lambda functions never receive them.

**Decision to confirm: the sign-up form asks for a first name.** The frontend shows "Welcome back, Alex!" and the account name from the `given_name` claim, and Cognito's hosted sign-up page shows the attributes marked required (I have not seen it, because no domain exists yet). A pool's attribute list cannot be changed after creation: changing it replaces the pool and deletes its users. The `dev` pool has no users yet, so changing this is cheap now and costly later. If you would rather collect only the email address, say so before real users sign up.

### App client settings

| Setting | Value |
|---------|-------|
| Client secret | None. This is a public browser client, and anything in browser code can be read. |
| OAuth flow | Authorization code only. The implicit flow is off, so tokens never appear in a URL. |
| Scopes | `openid`, `email`, `profile`. No admin scope, so tokens cannot be used to call Cognito's user-management API. |
| Identity providers | Cognito's own user directory only. No social or federated login. |
| Direct sign-in flows | SRP and refresh. No plain-password flow and no custom auth. |
| Callback and logout URL | One each, from the `FrontendCallbackUrl` and `FrontendLogoutUrl` parameters. `dev` default: `http://localhost:5500/`. |
| Token lifetimes | Access token 60 minutes, ID token 60 minutes, refresh token 7 days |
| Token revocation | On |
| Account enumeration | Sign-in and reset errors do not reveal whether an email has an account |
| Readable attributes | `email`, `email_verified`, `given_name`, `family_name`, `name` |
| Writable attributes | `email`, `given_name`, `family_name`, `name`. `email_verified` is read-only. |

The URL parameters accept only `https://` addresses or `http://localhost`, with no wildcards. **Set both to the real `https://` address of the website before real users sign in, and always for `prod`.** The `localhost` default is only for development. Changing a URL should update the client in place (not tried yet), so read the change set for `Replacement` before applying it.

### Tokens

| Token | Contains | Use |
|-------|----------|-----|
| ID token | `sub`, `email`, `email_verified`, `given_name`, plus `name` and `family_name` if set | Identifies the user. This is the one the frontend reads its account details from. |
| Access token | `sub`, `scope`, `client_id`. No email or name. | Authorises API calls. |

The Lambda functions only need `sub`, which both tokens carry.

### What the frontend needs (not done: the frontend was not modified)

The existing frontend code is compatible with this configuration. Every claim it reads (`sub`, `email`, `email_verified`, `given_name`, `family_name`, `name`) is available in the ID token. It still cannot sign anyone in, because:

1. **There is no hosted-UI domain.** `frontend/js/config.js` needs a `hostedUiDomain`, and `Auth.isConfigured()` stays false without it. A domain is a separate Cognito resource (`AWS::Cognito::UserPoolDomain`) that this step deliberately did not create. Add it to the template when the frontend login is built. Its prefix must be unique in the region.
2. **There is no login code.** `frontend/js/auth.js` only has a TODO. It must redirect to the hosted UI with PKCE (`response_type=code`, `code_challenge_method=S256`, a `state` value, scopes `openid email profile`), then exchange the returned code at the token endpoint. A public client sends no secret. It then calls `Auth.setToken(...)`.
3. **Store the ID token,** because the Dashboard and Settings read the name and email from the stored token.
4. **Fill in `config.js`:** `region` `us-east-1`, `userPoolId`, `clientId`, `hostedUiDomain`, and `redirectUri` and `logoutUri` exactly equal to the two URL parameters (the hosted UI rejects any difference, including a missing trailing slash).
5. **Sign-up, email verification and "forgot password" pages need no frontend code.** The hosted UI provides them.
6. **`Auth.getLogoutUrl()` already builds the right logout URL,** once the domain is set.
7. **Tokens last 60 minutes and the frontend does not refresh them.** After that the user signs in again. Refresh-token support would be a later frontend feature.
8. **The raw token in the `Authorization` header is fine.** The frontend sends the token with no `Bearer ` prefix, and the deployed API accepts that (tested with real tokens).

### Limits and things to know

- **Built-in email limit.** Cognito's own email sender is capped at about 50 emails per day, which is fine for development only. Before real users sign up, switch to Amazon SES (its own step).
- **No attribute changes after creation** (see the decision above).
- **Nothing was tested end to end.** No account has been created, no verification email sent and no sign-in attempted. The sign-in page does not exist until a domain does. What was verified is that the live configuration read back from AWS matches the template, and that the issuer's discovery document and signing keys are published.
- **`prod` and `test` have not been deployed.** Their Cognito settings are only checked by reading the template.

### How the API uses Cognito

API Gateway's JWT authorizer (see the API Gateway section) checks every request against this pool:

- **Issuer:** the `CognitoIssuerUrl` output. **Audience:** the app client ID. Both are filled in by CloudFormation references, not typed.
- **Signing keys:** published at the issuer's `/.well-known/jwks.json` (RS256).
- **Tokens accepted (before the scope change, Step "Access-token scopes"):** both ID tokens (`aud` is checked) and access tokens (`client_id` is checked), with or without a `Bearer ` prefix. This was the gap: see the "API authorization section". Once the scopes are deployed, only access tokens that carry a `cluenest-api/*` scope are accepted.
- **Which token the frontend sends:** the access token, as `Authorization: Bearer <access token>`. The ID token is only decoded in the browser for the account details the screens display. It is never sent to the API.
- The Lambda functions only need `sub`, which both tokens carry.

## API Gateway section

One HTTP API (`AWS::ApiGatewayV2::Api`), reached over HTTPS only. **Every route requires a valid Cognito token.** There are no public routes and no catch-all route. A request that matches no route gets 404.

Values of the deployed `dev` stack (public identifiers, not secrets). Read them any time from the stack outputs:

| Value | Output name | `dev` |
|-------|-------------|-------|
| API ID | `ApiId` | `ttgu8aq0bh` |
| Base URL (goes in `apiBaseUrl` in `frontend/js/config.js`, no trailing slash) | `ApiBaseUrl` | `https://ttgu8aq0bh.execute-api.us-east-1.amazonaws.com/dev` |
| Allowed browser origin | `CorsAllowedOrigin` | `http://localhost:5500` |
| Access log group | `ApiAccessLogGroupName` | `/aws/vendedlogs/apigateway/ClueNestApi-dev` |

```powershell
aws cloudformation describe-stacks --stack-name cluenest-infrastructure-dev --region us-east-1 --query "Stacks[0].Outputs[?starts_with(OutputKey,'Api')||OutputKey=='CorsAllowedOrigin']"
```

The stage is named after the environment, so every URL has `/dev` after the host. `AutoDeploy` publishes route changes by itself.

### Routes

The paths are the ones the Lambda functions implement and the frontend already uses. The path parameter is always named `id`. All 18 routes use the JWT authorizer.

| Method and path | Lambda function |
|-----------------|-----------------|
| `GET /appliances`, `POST /appliances` | `ClueNestAppliances-<env>` |
| `GET /appliances/{id}`, `PUT /appliances/{id}`, `DELETE /appliances/{id}` | `ClueNestAppliances-<env>` |
| `GET /maintenance`, `POST /maintenance` | `ClueNestMaintenance-<env>` |
| `GET /maintenance/{id}`, `PUT /maintenance/{id}`, `DELETE /maintenance/{id}` | `ClueNestMaintenance-<env>` |
| `POST /maintenance/{id}/complete` | `ClueNestMaintenance-<env>` |
| `GET /repair-history`, `POST /repair-history` | `ClueNestRepairHistory-<env>` |
| `GET /repair-history/{id}`, `PUT /repair-history/{id}`, `DELETE /repair-history/{id}` | `ClueNestRepairHistory-<env>` |
| `POST /troubleshoot` | `ClueNestTroubleshoot-<env>` (Bedrock, 28 s timeout) |
| `GET /technicians/search` | `ClueNestTechnicianSearch-<env>` (placeholder, answers 501) |

**No routes exist for** warranty checking and repair-versus-replace (the browser calculates both and there is no Lambda function for them) or for technician quotes (no Lambda function yet). Routes are added only for operations a function really implements. A script confirmed in both directions that every route reaches a function that supports its method and path, and that no operation a function implements is left without a route.

### Authorization

| Setting | Value |
|---------|-------|
| Authorizer | `ClueNestCognitoJwt-<env>`, type JWT, reads the `Authorization` header |
| Issuer | `https://cognito-idp.us-east-1.amazonaws.com/<user pool id>`, from `!Ref UserPool` |
| Audience | The app client ID, from `!Ref UserPoolClient` |
| What it checks | Signature against the pool's published keys, issuer, audience (or `client_id` for an access token), and expiry |
| Rejected requests | Get 401 and never reach a Lambda function, so they cost nothing and run no code |

No pool ID or client ID is typed into the template. As first deployed, the authorizer accepted the **ID token and the access token, each with or without a `Bearer ` prefix**, because routes had no scope requirement. The scope change (see the "API authorization section") makes every route require a scope, which only access tokens carry.

### CORS

| Setting | Value |
|---------|-------|
| Allowed origin | Exactly one: the website origin taken from `FrontendCallbackUrl` (scheme, host and port, without the path). `dev`: `http://localhost:5500`. No wildcard. |
| Methods | `GET`, `POST`, `PUT`, `DELETE` |
| Headers | `authorization`, `content-type` |
| Cookies / credentials | Not allowed |
| Preflight cache | 1 hour |

The browser sends a preflight `OPTIONS` request before any call carrying an `Authorization` header or a JSON body, which is every call the frontend makes. API Gateway answers it itself, without a token. Tested against the live API:

- A preflight from `http://localhost:5500` for GET and for POST returns 204 with the allowed origin, methods and headers.
- A preflight from any **other origin, header or method** (`https://evil.example`, `x-api-key`, `PATCH`) also returns 204 but with **no CORS headers**, so the browser blocks the call.
- A `401` response carries the CORS header for the allowed origin, so the frontend can read it and say "please sign in again". A foreign origin gets no CORS header on it.

`http://localhost:5500` and `http://127.0.0.1:5500` are different origins. Open the app at the `localhost` address. Moving to a real website means changing `FrontendCallbackUrl` and `FrontendLogoutUrl`, which updates both the sign-in redirect and CORS together.

### Throttling

Each route allows 20 requests per second on average with bursts up to 40. Requests over the limit get 429. These are conservative starting values for a small app and **were not load-tested**. They apply per route, not per user. API Gateway's account-wide limits still apply above them. Nothing limits Lambda concurrency or a single user's request rate; per-user limits would need a usage plan or application code.

### Access log

One JSON line per request in `/aws/vendedlogs/apigateway/ClueNestApi-<env>`, kept 30 days in `dev` and `test` and 90 days in `prod`.

| Field | Content |
|-------|---------|
| `requestId`, `requestTime`, `method`, `routeKey`, `status` | What was called and the result. `routeKey` is the route template (`GET /appliances/{id}`), not the real id. |
| `responseLength`, `latencyMs`, `integrationStatus` | Size and timing. `integrationStatus` is the Lambda function's status. |
| `integrationError`, `error` | Short error text from API Gateway, `-` when there is none |
| `ip` | The caller's IP address, for abuse investigations |
| `sub` | The signed-in user's id, `-` for rejected requests |

**Never logged:** the `Authorization` header or any token, request or response bodies, query strings (a technician search carries a place name), the user agent, the email address or the name.

Notes:

- **API Gateway does not escape the text it inserts** into the line. The authorizer's error text for a forged token contains double quotes, which broke the JSON in the first deployment. The field was removed (`$context.authorizer.error`), and **it must not be added back**. `error` and `integrationError` have only ever held quote-free text, but if a line ever fails to parse, check those two.
- When log delivery is set up or changed, CloudWatch writes one plain-text line ("Permissions are set correctly to allow AWS CloudWatch Logs..."). A parser should skip lines that do not start with `{`.
- The `ip` and `sub` fields are personal data. They are deleted by the retention setting. Remove them from the format if you do not need them.
- Read the log:

  ```powershell
  aws logs tail /aws/vendedlogs/apigateway/ClueNestApi-dev --since 15m --region us-east-1
  ```

- The Lambda functions' own log groups (`/aws/lambda/ClueNest...-dev`) are created by Lambda on first use and **never expire**. They are not managed by this template. Retention for them belongs to the CloudWatch step.

### Permission for API Gateway to call each function

Five `AWS::Lambda::Permission` resources, one per function, each limited to this API, this stage and the paths that function serves. Nothing else can invoke the functions through API Gateway.

| Function | Allowed source (`<api id>/<stage>/<method>/<path>`) |
|----------|--------------------------------------------------|
| Appliances | `ttgu8aq0bh/dev/*/appliances*` |
| Maintenance | `ttgu8aq0bh/dev/*/maintenance*` |
| RepairHistory | `ttgu8aq0bh/dev/*/repair-history*` |
| Troubleshoot | `ttgu8aq0bh/dev/POST/troubleshoot` |
| TechnicianSearch | `ttgu8aq0bh/dev/GET/technicians/search` |

A script checked that each route is matched by its own function's permission and by no other function's, and that a different API, stage, account or path is matched by none. The deployed policies were read back from Lambda and are exactly these. In the end-to-end test every route worked, so the patterns match what API Gateway sends. The permissions have no `SourceAccount` condition, because the API ID is already unique to this account.

### Transport

HTTP APIs are HTTPS-only. Plain `http://` is refused, TLS 1.1 is refused and TLS 1.2 works. The default `execute-api` address is the only address; there is no custom domain.

### Example requests

Placeholders only: never paste a real token into a chat, a ticket or a file you commit. Tokens last 60 minutes. After the frontend login exists, a token is what `Auth.getToken()` returns in the browser console. Run from PowerShell:

```powershell
$base  = "https://ttgu8aq0bh.execute-api.us-east-1.amazonaws.com/dev"
$env:CLUENEST_TOKEN = "<paste an ACCESS token that has the cluenest-api scopes, for this terminal session only>"

# 1. No token: expect 401  {"message":"Unauthorized"}
curl.exe -s -i "$base/appliances"

# 2. List the signed-in user's appliances: expect 200 {"appliances": [...], "count": n, "truncated": false}
curl.exe -s -H "Authorization: $env:CLUENEST_TOKEN" "$base/appliances"

# 3. Create an appliance: expect 201 {"appliance": {...}}
'{"name":"Kitchen Fridge","type":"Refrigerator","brand":"LG","purchaseDate":"2024-01-10","warrantyYears":2}' | Set-Content body.json -Encoding ascii
curl.exe -s -X POST -H "Authorization: $env:CLUENEST_TOKEN" -H "Content-Type: application/json" --data-binary "@body.json" "$base/appliances"

# 4. Read, change and delete one appliance (use the id from step 3)
curl.exe -s -H "Authorization: $env:CLUENEST_TOKEN" "$base/appliances/<appliance id>"
curl.exe -s -X DELETE -H "Authorization: $env:CLUENEST_TOKEN" "$base/appliances/<appliance id>"

# 5. Mark a maintenance reminder complete (a repeating one gets its next occurrence)
curl.exe -s -X POST -H "Authorization: $env:CLUENEST_TOKEN" -H "Content-Type: application/json" -d "{}" "$base/maintenance/<reminder id>/complete"

# 6. The browser's preflight check, from the allowed origin: expect 204 with access-control-allow-* headers
curl.exe -s -i -X OPTIONS -H "Origin: http://localhost:5500" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type" "$base/appliances"

# 7. A placeholder: expect 501 {"code":"NOT_CONFIGURED", ...}
curl.exe -s -X POST -H "Authorization: $env:CLUENEST_TOKEN" -H "Content-Type: application/json" -d '{"applianceId":"<appliance id>","category":"Other","description":"test"}' "$base/troubleshoot"

Remove-Item Env:\CLUENEST_TOKEN; Remove-Item body.json
```

In the browser the same calls work once `apiBaseUrl` is set, because the frontend already sends the same header. The `Bearer ` prefix is optional.

### What the frontend needs (not done: the frontend was not modified)

1. In `frontend/js/config.js` set `apiBaseUrl` to the `ApiBaseUrl` output and `technicianSearchPath` to `/technicians/search`.
2. The login (see the Cognito hosted sign-in section) sends the access token as `Authorization: Bearer <access token>`. The ID token is not sent.
3. **Maintenance, Repair History and Technician Quotes still use browser storage,** not these routes. Switching the first two to `/maintenance` and `/repair-history` is a separate frontend task. Quotes have no routes yet.
4. A 401 means the token is missing, invalid or expired. The existing `Api` code already shows "Your session is not authorised. Please sign in again."
5. Technician search needs the Google key in Secrets Manager (done) and the technician-search deployment (see the Technician search section). Troubleshooting answers from Bedrock once the stack is deployed with a verified model (see the Bedrock section). The frontend already shows the server's message.

### Limits and things to know

- **Unauthenticated callers can tell which paths exist.** A real route returns 401 and an unknown one returns 404. This reveals nothing beyond the route names in this README.
- **First request after a quiet period is slower.** The functions cold-start. A cold request was seen taking up to about 1.7 seconds in testing.
- **A Lambda timeout** (10 seconds, 25 for technician search) appears to the caller as a 5xx error.
- **Request size:** the functions refuse bodies over 100 KB. API Gateway itself allows up to 10 MB.
- **Deleting the `dev` stack** deletes the API, its log group and its data. `prod` keeps its log group, table and user pool.
- **The template is about 35 KB** of the 51,200-byte direct-upload limit (see "Adding a future service").

## Bedrock section

**Status: implemented and tested with a fake Bedrock client. Not deployed.** In this account every model tried returned `ThrottlingException` ("Too many tokens") or access errors, and Service Quotas shows 0 for the tokens-per-minute and tokens-per-day quotas. Deploy only after a real Converse call succeeds (see "Before deploying").

### What changed

| Part | Change |
|------|--------|
| `lambda/src/troubleshoot.py` | Same function (`ClueNestTroubleshoot-<env>`, route `POST /troubleshoot`). No new Lambda. Now calls Bedrock. |
| `BedrockModelId` parameter | Optional, default empty (Bedrock off). The `modelId` passed to Converse. Pattern allows no wildcards. While empty: no `BedrockInvokePolicy`, no `BEDROCK_MODEL_ID`, timeout stays 10 s, and non-dangerous troubleshooting answers 501. |
| `BedrockBaseModelId` parameter | Empty for a plain model ID. For an inference profile (`us.*`, `global.*`), the underlying foundation model ID. |
| `BedrockInvokePolicy` | New `AWS::IAM::Policy` on the existing role. Only `bedrock:InvokeModel`. |
| `TroubleshootFunction` | Environment `BEDROCK_MODEL_ID`. Timeout 10 s to 28 s (HTTP API waits at most 30 s). Depends on the new policy. |
| Output `BedrockModelIdInUse` | The model ID in use. |

### IAM

Plain model ID: `arn:aws:bedrock:<region>::foundation-model/<BedrockModelId>`.
Inference profile: `arn:aws:bedrock:<region>:<account>:inference-profile/<BedrockModelId>` and `arn:aws:bedrock:*::foundation-model/<BedrockBaseModelId>` (Bedrock checks both, and a cross-Region profile may run the model in several Regions).
No streaming permission, because the code does not stream. No other Bedrock action. The DynamoDB and CloudWatch Logs permissions are unchanged. The role is shared, so the permission technically applies to every ClueNest function, but only the troubleshooting code calls Bedrock.
Checked with the IAM policy simulator on both rendered policies: the chosen model is allowed. Another model, another profile, `InvokeModelWithResponseStream`, `ListFoundationModels` and `CreateModelCustomizationJob` are denied.

### How a request is handled

1. Validate the body and check that the appliance belongs to the signed-in user (404 otherwise). Invalid requests never reach the model.
2. **Safety rules (no AI).** If the description or error code mentions a gas smell or leak, smoke or a burning smell, sparks, exposed or frayed wiring, an electric shock, or water near an outlet, plug, wiring or control panel, the function answers 200 with `hazardDetected: true`, `mode: "safety-rules"` and fixed guidance: stop using the appliance, leave the area for gas (call the gas utility or 911 from outside), switch off the breaker only if it can be reached safely, never open the appliance, call a licensed electrician or technician. This works even when Bedrock is down or not configured. The rules are keyword based and err on the side of warning (for example "smoke detector" also triggers them).
3. Otherwise one Converse call with a system prompt and the user text inside `<user_input>` tags (the prompt says that text is data, and the tags are stripped from user text). `maxTokens` 1500, temperature 0.2, no retry, 20 s read timeout.
4. The answer must be one JSON object with lists of strings. Each list is capped at 8 items of 400 characters. Anything else gives 502 `AI_BAD_RESPONSE`.
5. **Unsafe steps are removed** (opening panels or covers, touching wiring or terminals, meters, bypassing or disabling safety parts, gas lines or valves, replacing internal parts). If no safe steps or no causes remain, the answer is rejected. If the model itself sets `hazardDetected`, its steps are replaced with the fixed electrical stop-and-call guidance.
6. A "Contact a professional if: ..." line and the sentence "These are possible causes, not a confirmed diagnosis..." are added to `safetyWarnings`, because the current frontend only shows `safetyWarnings`, `possibleCauses` and `recommendedSolutions`.

Nothing is saved, and the request text, model answer and error messages are not logged. Only the Bedrock error code and token counts are logged.

### Response (200)

`mode` (`bedrock` or `safety-rules`), `hazardDetected`, `safetyResponse`, `safetyWarnings`, `possibleCauses`, `recommendedSolutions`, `callProfessionalIf`, `disclaimer`. The frontend's `parseResult` already reads the first five. `mode: "bedrock"` makes it show the answer as real Bedrock output.

### Errors (no made-up answer, no internal details)

| Status | Code | When |
|--------|------|------|
| 503 | `AI_BUSY` | `ThrottlingException`, `TooManyRequestsException`, `ServiceQuotaExceededException` (this is what a zero quota looks like) |
| 503 | `AI_UNAVAILABLE` | Service unavailable, model not ready or timed out, access denied, model not found, validation error, read or connect timeout |
| 502 | `AI_BAD_RESPONSE` | Unusable or unsafe model answer |
| 501 | `NOT_CONFIGURED` | `BEDROCK_MODEL_ID` empty (cannot happen when deployed through the template) |

### Choosing the model

Not chosen yet, because none could be called. The candidates in this account's model list are Amazon Nova Micro, Nova Lite and Nova 2 Lite, and Claude Haiku 4.5. Nova Lite is the first one to try (low price, supports Converse, enough for structured guidance), then Claude Haiku 4.5 for better answers. Check current prices on the Bedrock pricing page before choosing. The model is a stack parameter, so changing it needs no code change.

### Before deploying

1. Get usable quota (AWS Support case for on-demand or cross-Region tokens per minute, requests per minute and tokens per day for one model in us-east-1).
2. Prove it:
   `aws bedrock-runtime converse --region us-east-1 --model-id <ID> --messages file://msg.json --inference-config maxTokens=20`
   where `msg.json` is `[{"role":"user","content":[{"text":"Reply with OK."}]}]`. It must return text, not a `ThrottlingException`.
3. Build and upload a new zip (new key), then deploy with `BedrockModelId=<ID>` (and `BedrockBaseModelId=<base ID>` for a profile). Review the change set first: expect `Modify` on `TroubleshootFunction` and `Add` for `BedrockInvokePolicy`.
4. Test through the API with a real token, once with a normal problem and once with a hazard sentence.

## Validation results (Bedrock step)

| Check | Result |
|-------|--------|
| Account check | Bedrock is available in us-east-1 and lists many models. 20 Converse calls on 20 model IDs (Nova, Claude, gpt-oss, Qwen, Mistral, Llama, Gemma, GLM, DeepSeek): all failed with throttling ("Too many tokens"), end-of-life or access denied. Quotas for Nova and Claude Haiku tokens per minute and per day are 0. |
| `cfn-lint` | No findings (default and informational). |
| `aws cloudformation validate-template` | Passed. Lists 7 parameters. |
| Template size | About 38 KB. |
| Python | `pyflakes` clean, compiles on Python 3.12. |
| Unit tests | 109 pass (was 87). The 22 new ones use a fake Bedrock client: washing machine not draining, fridge not cooling, error code, 17 hazard sentences in 4 groups (no model call), hazard words in the error code field, ordinary problems not flagged, model-flagged hazard, unsafe step removal, throttling, quota, unavailable, access denied, timeouts, 12 kinds of unusable answers, output cleaning, prompt tag stripping, unconfigured model, validation, ownership, no sensitive logging, client timeout and no retry. |
| IAM simulation | Allowed: the chosen model (and its profile). Denied: other models, streaming, listing, customization. |
| Frontend | Not modified. |

**Not tested:** any real Bedrock response, so answer quality, real latency, token cost and whether the chosen model accepts the system prompt and settings are unknown. A change set has not been created.

## Secrets Manager section

**Status: deployed to `dev`. The secret is an empty container. No key has been entered.**

| Item | Value |
|------|-------|
| Resource | `GooglePlacesSecret` (`AWS::SecretsManager::Secret`) |
| Name | `cluenest/google-places/<env>` (`cluenest/google-places/dev` in `dev`) |
| ARN | In the stack output `GooglePlacesSecretArn` (the name plus a random suffix AWS adds) |
| Value | None. CloudFormation never writes or changes the value, so stack updates cannot overwrite your key. No key, fake key, parameter or output exists. |
| Encryption | AWS managed key `alias/aws/secretsmanager` (the default). Roles in the same account need no `kms:Decrypt` permission for it, so none is granted. |
| Deletion | `dev` and `test`: deleting the stack schedules the secret for deletion with a 30-day recovery window (the name cannot be reused during it). `prod`: the secret is kept. |

### IAM

The technician-search function now has its own role, `ClueNestTechnicianSearchRole-<env>`, so the shared `LambdaExecutionRole` has no Secrets Manager permission.
The new role has `AWSLambdaBasicExecutionRole` (CloudWatch Logs) and one inline statement: `secretsmanager:GetSecretValue` on the exact secret ARN. It has no DynamoDB, Bedrock, KMS or other Secrets Manager permission (the function does not use the database). The policy simulator confirmed: the secret is allowed for the technician role only; other secrets, `PutSecretValue`, `DescribeSecret`, `ListSecrets`, `DeleteSecret`, DynamoDB, Bedrock and KMS are denied. The shared role is denied everything on the secret.

### Lambda (`technician_search.py` and new `cluenest_secrets.py`)

- The function reads the secret ARN from the environment variable `GOOGLE_PLACES_SECRET_ARN` (set by the template with `!Ref GooglePlacesSecret`). The key is not in the code or the environment.
- Order of work: authenticate, validate the query (400), read the key, then answer. Invalid requests never call Secrets Manager.
- `cluenest_secrets.get_secret_string` calls `GetSecretValue` with a 2 s connect and read timeout and one retry, and caches a successful value in memory for 5 minutes. A rotated or replaced key is picked up within 5 minutes. Failures are never cached, so a key entered after deployment works on the next request.
- The key is expected as plain text (8 to 256 printable characters, no spaces). `{"apiKey": "..."}` and `{"GOOGLE_PLACES_API_KEY": "..."}` are also accepted.
- Results: no variable, an empty container, a missing secret or an unusable value gives 501 `NOT_CONFIGURED`. Access denied, throttling, service errors and timeouts give 503 `SEARCH_UNAVAILABLE`. Neither includes AWS text.
- **The key is never returned, sent to the frontend or logged.** Only the AWS error code is logged (for example `ResourceNotFoundException`), never an error message, the ARN or the value.
- With a valid key the function now searches Google Places (see the Technician search section).

### Entering the real Google Places API key

Do this yourself, once, outside the project, and never paste the key into a chat, a file or a commit.

1. In Google Cloud, create an API key for the **Places API** only. Restrict it to that API. Do not use a browser key.
2. Enter it with either method.
   - Console: Secrets Manager (us-east-1), open `cluenest/google-places/dev`, choose **Set secret value** (or Retrieve secret value, Edit), pick **Plaintext**, paste the key, and save.
   - PowerShell (the key is not echoed or saved in history):
     ```powershell
     $secure = Read-Host -AsSecureString "Google Places API key"
     $file = New-TemporaryFile
     [IO.File]::WriteAllText($file.FullName, [System.Net.NetworkCredential]::new("", $secure).Password)
     aws secretsmanager put-secret-value --secret-id cluenest/google-places/dev --secret-string "file://$($file.FullName)" --region us-east-1
     Remove-Item $file.FullName -Force
     ```
3. Check that it is stored without reading it: `aws secretsmanager describe-secret --secret-id cluenest/google-places/dev --region us-east-1 --query VersionIdsToStages` now lists a version with `AWSCURRENT`. A technician search then answers 501 a search result instead of `NOT_CONFIGURED`.
4. To replace or rotate the key, repeat step 2. Do not run `get-secret-value` in a shared terminal, because it prints the key.
## Technician search section

**Status: code and tests written, not deployed.** No test ever calls Google. The real API has not been called by this project.

### API (unchanged contract, no frontend change)

`GET <technicianSearchPath>?location=<city or postal code>&radiusKm=<5|10|25|50>&applianceType=<type>`, Cognito token required (same as every private route). Only `location` is required. The frontend (`frontend/js/find-technician.js`) already reads this response, so nothing in `frontend/` changes.

Response 200:

```json
{
  "results": [
    {"placeId": "...", "name": "...", "address": "...", "phone": "...", "website": "https://...",
     "mapsUrl": "https://maps.google.com/?cid=...", "rating": 4.6, "reviewCount": 120, "openNow": true,
     "distanceKm": 2.0, "location": {"latitude": 0.0, "longitude": 0.0}}
  ],
  "radiusKm": 25,
  "searchedLocation": "Toronto, ON, Canada",
  "source": "Google Places"
}
```

Only fields that Google returned are present. A business without a rating has no `rating`. `results` may be empty (the frontend shows "No technicians found"). Results are real Google data only, nearest first, at most 20.

### How it works (`google_places.py`, called from `technician_search.py`)

1. Authenticate (Cognito) and validate the query exactly as before. Invalid requests (400) never reach Secrets Manager or Google.
2. Read the key with `cluenest_secrets.get_secret_string` (the existing helper and 5 minute cache). The secret is **plain text**, or JSON with an `apiKey` or `GOOGLE_PLACES_API_KEY` field. Nothing about the secret or its format changes.
3. **Google call 1**, to turn the typed location into coordinates: `POST https://places.googleapis.com/v1/places:searchText` (Places API New, Text Search) with `textQuery` = the location, `pageSize` 1, `regionCode` CA, field mask `places.location,places.formattedAddress`.
4. **Google call 2**: the same endpoint with `textQuery` = a fixed phrase from the appliance type (`refrigerator repair`, `washing machine repair`, `dryer repair`, `dishwasher repair`, `oven repair`, `microwave repair`, `air conditioner repair`, otherwise `appliance repair`), `pageSize` 20, and a `locationRestriction` rectangle that bounds the radius (default 25 km). User text never goes into this search phrase.
5. Keep only businesses within the radius by straight-line distance, drop permanently closed and duplicate ones, sort nearest first.

The key travels only in the `X-Goog-Api-Key` header to `places.googleapis.com` over HTTPS. It is not in any URL, response, log line or error message. Each Google call has a 7 second timeout and is not retried.

### Errors (Google's text is never passed on)

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Bad `location`, `radiusKm` or `applianceType` |
| 401 | `UNAUTHENTICATED` | No valid token |
| 404 | `LOCATION_NOT_FOUND` | Google could not place the typed location |
| 501 | `NOT_CONFIGURED` | No secret variable, empty secret container, or an unusable value |
| 503 | `SEARCH_MISCONFIGURED` | Google rejected the key or setup (401, 403, invalid or restricted key, API not enabled, billing) |
| 503 | `SEARCH_BUSY` | Google quota or rate limit (429, `RESOURCE_EXHAUSTED`, rate-limit reasons) |
| 503 | `SEARCH_UNAVAILABLE` | Secrets Manager failure, Google 5xx, other HTTP or network errors |
| 504 | `SEARCH_TIMEOUT` | A Google call timed out |
| 502 | `SEARCH_BAD_RESPONSE` | Google's answer was not valid or too large |

Logged: HTTP status, Google's upper-case `status` and `reason` codes (for example `PERMISSION_DENIED`, `API_KEY_INVALID`), and counts. Never logged: the key, the location typed, business names, addresses or phone numbers, user IDs, Google's message text.

### Google Cloud setup needed

- Enable **Places API (New)** in the Google Cloud project (the old "Places API" is a different product and does not work with this endpoint).
- Billing must be enabled on the project.
- The key must be allowed to call Places API (New). Restrict it to that API. Do not add an HTTP referrer restriction (calls come from AWS, not a browser). An IP restriction is not practical for Lambda.
- Cost: call 1 uses fields billed as Text Search Pro. Call 2 requests rating, review count, website, phone and opening hours, which Google bills as Text Search Enterprise. Check current prices and set a budget alert and a daily quota cap in Google Cloud. To make searches cheaper, remove those fields from `BUSINESS_FIELD_MASK` in `google_places.py` (the frontend copes with missing fields).
- Google's terms require showing the Google Maps attribution and not storing Places content. Nothing is stored. The frontend links each result to Google Maps.

### Infrastructure change

Only the technician function's timeout changes, 10 s to 25 s, so two 7 second Google calls and a slow secret read fit. No permission is needed: the role already reads the secret, and Lambda reaches Google over the internet without a VPC. The new code ships in the same zip as the other functions.

### Limits to know about

- The location text is resolved by Google's top match. An ambiguous name (for example "Springfield") can resolve to an unexpected place. `searchedLocation` in the response shows what was used, but the frontend does not display it yet.
- The radius is a straight-line distance. Up to 20 businesses are returned, so a large radius in a big city shows the 20 Google ranks highest inside the square, not necessarily the 20 nearest.
- Throttling per user and a search quota per user are not implemented. API Gateway throttles each route at 20 requests/s.
## Cognito hosted sign-in section

**Status: the domain is deployed to `dev` (stack `UPDATE_COMPLETE`, one `Add`). The frontend is in the project and tested with fakes. No real sign-up or sign-in has been tried.** The user pool and app client are reused. The only new infrastructure resource is the sign-in domain.

### What already existed and what was missing

| Part | Before |
|------|--------|
| User pool `ClueNestUsers-<env>` | Reused unchanged. E-mail sign-in, e-mail codes, `given_name` required. |
| App client `ClueNestWebClient-<env>` | Reused unchanged. Public client (no secret), authorization code flow only, scopes `openid email profile`, callback and logout `http://localhost:5500/`, token revocation on. Nothing about it needs to change. |
| JWT authorizer | Unchanged by sign-in. On its own it accepted access tokens and ID tokens alike (see the "API authorization section"). |
| Sign-in domain | **Missing.** Without it no sign-in page exists. |
| Frontend login | **Missing.** `auth.js` only read a token from `sessionStorage`, and `config.js` was empty. |

### Infrastructure change (template only, one resource)

- `UserPoolDomain` (`AWS::Cognito::UserPoolDomain`), classic hosted UI (`ManagedLoginVersion: 1`), Cognito-managed prefix, no custom domain, no certificate.
- New parameter `CognitoDomainPrefix` (default `cluenest-ai`). The domain is `<prefix>-<Environment>`, so `dev` is `cluenest-ai-dev`, giving `https://cluenest-ai-dev.auth.us-east-1.amazoncognito.com`. The name was free when checked (`describe-user-pool-domain` returned nothing). If someone claims it before deployment, the stack update fails and rolls back, and nothing else changes. Choose another prefix then.
- New output `CognitoHostedUiDomain`.
- The change set preview showed exactly one change: `Add UserPoolDomain`. No Modify, no Remove, no new Lambda zip.

### Callback and logout addresses

`frontend/README.md` runs the site with `python -m http.server 5500`, and the client already allows `http://localhost:5500/` for both. They are used unchanged, so `config.js` has `redirectUri` and `logoutUri` `http://localhost:5500/`. Other ports or `127.0.0.1` are rejected by Cognito (`redirect_mismatch`). For a real site, redeploy with `FrontendCallbackUrl` and `FrontendLogoutUrl` set to its https address and update `config.js` to match. CORS follows `FrontendCallbackUrl` automatically.

### How sign-in works (`frontend/js/auth.js`)

1. **Sign in or Create account** (shown instead of every screen while nobody is signed in): the browser goes to `/oauth2/authorize` (or `/signup`) with `response_type=code`, scopes `openid email profile`, a random `state` and `nonce`, and a PKCE `code_challenge` (S256 of a random 64 character verifier). The verifier, state, nonce and the current screen are kept in `sessionStorage` for at most 10 minutes.
2. **Registration and e-mail verification** are done on the Cognito pages: sign-up form (with first name), a 6 digit code e-mailed by Cognito, then automatic sign-in. Cognito's built-in e-mail is limited to about 50 messages a day.
3. **Callback** (`http://localhost:5500/?code=...&state=...`): the address is cleaned at once, `state` must match, the sign-in must be less than 10 minutes old, and the code must look like a code. The code is exchanged at `/oauth2/token` with the verifier (10 second timeout, no secret). The returned tokens are checked: right app client, right pool issuer, token types, same user in both tokens, the ID token's nonce, not near expiry. Anything wrong shows "Sign-in could not be completed" and leaves the user signed out. A callback works once only.
4. **Session**: access token and ID token are kept in `sessionStorage` (this tab only, cleared when the tab closes, never `localStorage`). A page refresh restores the session. The refresh token is not stored or used.
5. **API calls** send `Authorization: Bearer <access token>`. The ID token is only read in the browser for the first name and e-mail shown on screen.
6. **Expiry**: the access token lasts 60 minutes. An expired token is never sent. The next screen change shows "Your session has expired" with the Sign in button, and a `401` from the API ends the session the same way. Signing in again is usually one redirect, because Cognito's own session cookie lasts up to an hour.
7. **Sign out** (Settings): the local session and ClueNest data for the tab are removed, then the browser visits Cognito's `/logout`, which ends the Cognito session.

### Limits of a browser-only sign-in

- Anything running on the page, such as a cross-site scripting flaw or a harmful third-party script, could read `sessionStorage`. Keep third-party scripts out of the site, and escape all text (the screens already do).
- PKCE protects the code exchange, but Cognito does not force public clients to use it. The server cannot stop another client written without PKCE.
- Tokens are checked in the browser only for shape and matching claims. The signature is verified by API Gateway, which is what protects the data.
- Without a refresh token a user signs in again after 60 minutes. A backend that holds tokens in an HttpOnly cookie would avoid both problems, and would be a larger change.
- `localhost` is a secure context, so the browser's crypto functions work. A real site must use https.

### Deployment (done)

```powershell
aws cloudformation deploy --template-file backend/cloudformation/cluenest-infrastructure.yaml --stack-name cluenest-infrastructure-dev --parameter-overrides Environment=dev LambdaCodeBucket=cluenest-ai-artifacts-<account id> LambdaCodeKey=lambda/cluenest-backend-20261122-233526.zip FrontendCallbackUrl=http://localhost:5500/ FrontendLogoutUrl=http://localhost:5500/ --capabilities CAPABILITY_NAMED_IAM --region us-east-1 --no-execute-changeset
```

Then review the change set (expect only `Add UserPoolDomain`), run `execute-change-set` once, and wait for `UPDATE_COMPLETE`. No Lambda code changes, so the existing zip key is reused. The stack output `CognitoHostedUiDomain` must equal `hostedUiDomain` in `frontend/js/config.js`.

### Manual steps

None in the AWS Console. After deployment, open `http://localhost:5500/`, choose Create account, and complete the e-mail code. That sends a real e-mail, so it is left to you.
## API authorization section

**Status: deployed to `dev` and verified live.** ID tokens are no longer accepted.

### Why an ID token was accepted

The API is an HTTP API with one JWT authorizer (`ClueNestCognitoJwt-dev`): issuer = the user pool, audience = the app client, identity source `$request.header.Authorization`. API Gateway checks the signature, `iss`, `aud` (or `client_id` when `aud` is absent) and `exp`. An ID token for this app client has `aud` = the client ID, so it passes every check, exactly like an access token. None of the 18 routes had an authorization scope, and the Cognito pool had no resource server. AWS documents that there is no standard way to tell the two token types apart and recommends requiring authorization scopes. Live read-back before the change: 18 of 18 routes `JWT` with empty scopes, and `list-resource-servers` returned none.

### The change (existing pool, client, API and authorizer are reused)

| Part | Change |
|------|--------|
| `UserPoolResourceServer` | New. Identifier `cluenest-api` with scopes `read` and `write`. |
| `UserPoolClient` | Same client, modified in place: `AllowedOAuthScopes` adds `cluenest-api/read` and `cluenest-api/write`. Still code flow only, no secret. |
| 18 routes | Each gets `AuthorizationScopes`: `cluenest-api/read` on every `GET` route (7), `cluenest-api/write` on every `POST`, `PUT` and `DELETE` route (11, including `POST /troubleshoot` and `POST /maintenance/{id}/complete`). |
| Authorizer | Unchanged. |
| `cluenest_common.get_user_sub` | Also requires the claim `token_use` = `access`, otherwise 401. A second lock, in case a route is ever left without a scope. |
| Frontend | `auth.js` requests `openid email profile cluenest-api/read cluenest-api/write`, refuses a token that lacks the API scopes, and drops an old stored session that lacks them ("ClueNest has been updated. Please sign in again"). `api.js` ends the session on 401 and on 403. |

Cognito puts a `scope` claim in an access token only when the sign-in asked for it and the client allows it. An ID token never has one, so an ID token fails the scope check.

### Expected results (status codes)

| Request | Result |
|---------|--------|
| No token, forged token, expired token, wrong client or issuer | 401 |
| Valid ID token | **403**, not 401. API Gateway returns 401 when the token itself is invalid and 403 when a valid token lacks the route's scope. An HTTP API JWT authorizer cannot return 401 for a well-formed token. The ID token is refused either way and never reaches Lambda. |
| Valid access token without the route's scope (for example a password-sign-in token) | 403 |
| Read-only token on a write route | 403 |
| Valid access token with the scope | 200 |

If a 401 for ID tokens is required, the only way is a Lambda authorizer that verifies the token and its `token_use` itself. That needs a new function, a JWT library in the zip and a call on every request, so it was not done.

### Things to know before deploying

- **Everyone signs in again once.** Sessions started before the change have no API scopes. The frontend drops them and asks for a new sign-in.
- **Only hosted sign-in tokens work.** Tokens from a direct password (SRP) sign-in carry only `aws.cognito.signin.user.admin`, so they get 403. The test scripts used earlier (SRP) can no longer call the API. This is intended.
- **Code change too.** `cluenest_common.py` changed, so the deployment includes a new Lambda zip (all functions are updated in place).
- The template is about 47 KB of the 51.2 KB direct limit, so add `--s3-bucket cluenest-ai-artifacts-<account id>` to the deploy command.
## Frontend hosting section

**Status: deployed to `dev` and the site is uploaded.** Bucket `cluenest-frontend-dev-<account id>`, distribution `E3LU0UH8UXYIUE`, address `https://d2z1tywpqu8eb2.cloudfront.net/`. After the first upload all 22 files returned 200 through CloudFront with the right content types, `http` redirected to `https`, the bucket answered 403 when read directly, and the API's CORS preflight from the CloudFront address succeeded.

### What is added (template section 7B)

| Resource | Type | Purpose |
|----------|------|---------|
| `FrontendBucket` | `AWS::S3::Bucket` | `cluenest-frontend-<env>-<account id>`. Private: all four Block Public Access settings on, ACLs disabled (`BucketOwnerEnforced`), AES256 encryption, no website hosting. Versioning on, old versions deleted after 30 days. `prod` keeps the bucket if the stack is deleted. |
| `FrontendBucketPolicy` | `AWS::S3::BucketPolicy` | Allows `s3:GetObject` to the CloudFront service only when the request comes from this distribution. Denies all plain http access. No list, put or delete permission. |
| `FrontendOriginAccessControl` | `AWS::CloudFront::OriginAccessControl` | CloudFront signs its S3 requests (SigV4). |
| `FrontendCachePolicy` | `AWS::CloudFront::CachePolicy` | 5 minute default cache (1 day at most when an object sets its own `Cache-Control`). Query strings, cookies and headers are not in the cache key, so the sign-in return (`/?code=...`) is served from cache and the code never reaches S3. gzip and Brotli on. |
| `FrontendDistribution` | `AWS::CloudFront::Distribution` | S3 REST endpoint origin with OAC. Default root object `index.html` (the real entry point of `frontend/`). Redirects http to https. GET and HEAD only. `PriceClass_100` (North America and Europe, cheapest). Default `*.cloudfront.net` certificate, so no domain or certificate. AWS's managed security-headers policy (HSTS, nosniff, frame deny, referrer policy). |

Outputs: `FrontendBucketName`, `FrontendDistributionId`, `FrontendUrl` (for example `https://dxxxx.cloudfront.net/`).

### Changes to existing resources (both in place, no replacement)

- `UserPoolClient` (the existing app client): `CallbackURLs` and `LogoutURLs` now list the localhost parameter value **and** `https://<distribution>.cloudfront.net/`. Localhost sign-in is unchanged. The authorization code flow, PKCE, the scopes (including `cluenest-api/read` and `cluenest-api/write`), the missing client secret and the user pool are untouched.
- `HttpApi`: CORS now allows two origins, the localhost one (from `FrontendCallbackUrl`) and the CloudFront one. Without this a browser on the hosted site could not call the API. No wildcard, no cookies, same methods and headers.

### Frontend change

`frontend/js/config.js` used to hard-code `http://localhost:5500/` as the sign-in return address, which would fail on the hosted site. It now uses the site's own `https://` address when served over https, and `http://localhost:5500/` otherwise (tested in `frontend/tests/config.test.js`). Nothing else changed.

### Navigation and refresh

The app uses hash routes (`#/appliances`), so the browser only ever requests `/`, and a refresh or pasted link works without any server rewrite. A file that does not exist in the private bucket answers 403, and CloudFront turns 403 and 404 into `index.html` (cached for 10 seconds), so a mistyped path still opens the app. The side effect: a broken script path returns HTML instead of an error, which shows up as a JavaScript syntax error in the browser console.

### Uploading the site and refreshing the cache (after the stack is deployed)

The stack creates the empty bucket. The 22 files the site needs are uploaded separately: `index.html`, `css/styles.css` and the 20 scripts in `js/` (the only files `index.html` loads; the site has no images, icons or fonts). `README.md` and `tests/` are not uploaded. Content types are set explicitly, because the CloudFront security-headers policy sends `X-Content-Type-Options: nosniff`, and a script served with a wrong type (for example `text/plain`, which some Windows registries give `.js`) would be blocked.

```powershell
$bucket = "cluenest-frontend-dev-870755687933"
$dist   = "E3LU0UH8UXYIUE"
$cache  = "public, max-age=300"
aws s3 sync frontend/js  "s3://$bucket/js"  --delete --exclude "*" --include "*.js"  --content-type "text/javascript; charset=utf-8" --cache-control $cache --region us-east-1
aws s3 sync frontend/css "s3://$bucket/css" --delete --exclude "*" --include "*.css" --content-type "text/css; charset=utf-8"        --cache-control $cache --region us-east-1
aws s3 sync frontend     "s3://$bucket"     --exclude "*" --include "index.html"      --content-type "text/html; charset=utf-8"       --cache-control $cache --region us-east-1
aws cloudfront create-invalidation --distribution-id $dist --paths "/*"
```

Run the three `sync` commands once with `--dryrun` first. It lists what would be uploaded and uploads nothing. The scripts and styles go first and `index.html` last, so the page never points at files that are not there yet. The files have no version number in their names, so run the invalidation after every upload (or wait up to 5 minutes). The first 1,000 invalidation paths a month are free.
### Deployment notes

- The template is now about 54 KB, **over the 51,200 byte direct limit**. Always deploy with `--s3-bucket cluenest-ai-artifacts-<account id>`. `validate-template` also needs `--template-url` (see the command in the report).
- Creating a distribution normally takes 5 to 15 minutes.
- Deleting a `dev` stack fails while the frontend bucket still holds files. Empty it first (versioned objects too).
- The CloudFront address is only known after deployment. If the `FrontendCallbackUrl` parameter is ever set to that same address, the client would list it twice and Cognito may refuse the update. Keep the parameter on localhost.

### Cost (check current prices)

- **S3:** storage for a few hundred KB, and requests from CloudFront. Cents a month.
- **CloudFront:** a monthly free allowance (data transfer and requests) currently covers a small site. `PriceClass_100` keeps data transfer rates lowest. No WAF, no logging and no custom domain, so none of their charges apply.
- **Invalidations:** free for the first 1,000 paths a month.
- No new always-on resource with an hourly charge.
## EventBridge section

**Status: deployed to `dev` and verified.** One manual test run read the table (1 item scanned, 0 due) and a non-schedule event was ignored. The first real scheduled run is at the next 12:00 UTC.

### What it does (and does not do)

Once a day, an EventBridge rule starts a Lambda function that finds the **pending maintenance reminders that are due today or overdue** and writes ONE log line with counts, for example `due_or_overdue=3 due_today=1 overdue=2 users=2`. **It does not notify anyone yet.** The stack has no notification service (SNS or SES is the next step), and a user's e-mail address is stored in Cognito, not in DynamoDB. The function reads only. It never completes, changes or deletes a reminder.

### Why a new function (and a new role)

`MaintenanceFunction` answers API Gateway requests for ONE signed-in user, so its handler needs a user and its role may only read that user's items (`GetItem`, `Query`, `PutItem`, `DeleteItem`). The daily check must look at every user's items. The table has no index by due date, so that needs `dynamodb:Scan`. Adding `Scan` to the shared `LambdaExecutionRole` would let every API function read the whole table. So the check is a separate function with its own role, and `maintenance.py` is unchanged. It reuses the shared helpers (`cluenest_common`) and the same zip.

### Resources added (template section 7C)

| Resource | Type | Purpose |
|----------|------|---------|
| `MaintenanceReminderRule` | `AWS::Events::Rule` | `cron(0 12 * * ? *)`: every day at 12:00 UTC (7 or 8 a.m. in Toronto). Enabled. One target. Failed starts are retried twice within an hour. |
| `MaintenanceReminderFunction` | `AWS::Lambda::Function` | `ClueNestMaintenanceReminders-<env>`, handler `maintenance_reminders.handler`, Python 3.12, arm64, 128 MB, 60 s. Environment: `TABLE_NAME` only. Not behind API Gateway. |
| `MaintenanceReminderInvokePermission` | `AWS::Lambda::Permission` | Only `events.amazonaws.com`, and only from this one rule's ARN. |
| `MaintenanceReminderRole` | `AWS::IAM::Role` | `AWSLambdaBasicExecutionRole` (logging) plus one statement: `dynamodb:Scan` on the ClueNest table ARN. No write, no index, no wildcard. |
| `MaintenanceReminderLogGroup` | `AWS::Logs::LogGroup` | `/aws/lambda/ClueNestMaintenanceReminders-<env>`, kept 30 days (90 in prod). |

Outputs: `MaintenanceReminderFunctionName`, `MaintenanceReminderRuleName`. No other resource changes, apart from the five API functions (and their integrations) getting the new zip, which now contains `maintenance_reminders.py`.

### How the check works (`maintenance_reminders.py`)

- It accepts only the EventBridge schedule event (`source` `aws.events`, `detail-type` `Scheduled Event`). Anything else is logged as ignored and the table is not touched.
- One paged `Scan` filtered to `entityType = MAINTENANCE`, `status = pending` and `dueDate <= today`, asking DynamoDB for only `userId` and `dueDate`. No task, appliance or note text is read.
- "Today" is the UTC date (due dates are calendar dates with no time zone). At 12:00 UTC that is the same date in North America.
- It stops early, and logs that it did, if less than 8 seconds of run time remain. It logs only counts: no user ID, appliance name, task name or note.

### Things to know

- **Scan cost and scale:** a Scan reads the whole table once a day. That is cents or less for a small table. For a large table, add an index on due date instead (a later change).
- **Time zone:** reminders are matched by UTC date, not each user's local date. Fine for a once-a-day check. Per-user time zones would need the user's zone to be stored.
- **No duplicate sends later:** when SNS delivery is added, it must record that a reminder was sent, because this check would otherwise find the same overdue reminder every day.
- The rule can be paused without a deploy: `aws events disable-rule --name ClueNestMaintenanceReminders-dev`. The stack would set it back to enabled at the next update.
- **Checking after deployment:** run the function once by hand with a scheduled-event test payload, then read its log line:

```powershell
'{"source":"aws.events","detail-type":"Scheduled Event","detail":{}}' | Out-File event.json -Encoding ascii
aws lambda invoke --function-name ClueNestMaintenanceReminders-dev --cli-binary-format raw-in-base64-out --payload file://event.json out.json --region us-east-1
```

### Cost (check current prices)

EventBridge scheduled rules to Lambda cost nothing extra (one invocation a day). Lambda: about 30 short invocations a month, inside the free tier. DynamoDB: one Scan a day (read units for the table's size). CloudWatch Logs: one line a day. No always-on resource.
## SNS notifications section

**Status: the backend is deployed to `dev` (stack `UPDATE_COMPLETE`, 7 resources added, 9 updated in place, none removed or replaced). No topic exists, nothing has been subscribed and no e-mail has been sent. The updated `api.js` and `settings.js` are uploaded to S3, so the hosted Settings screen shows the switch. No user has opted in. The first opt-in should be done and checked by hand.**

### Design decision: one SNS topic per user

| Option | Isolation | Verdict |
|--------|-----------|---------|
| **One topic per user** (`ClueNestReminders-<env>-<user id>`) | Structural. A topic has only its owner's address, so a message published to it can reach nobody else. No filter policy to get wrong. | **Chosen.** |
| One shared topic with a filter policy per user | Depends on every subscription having the right filter. A subscription created without one (or an operator adding an address by hand) receives every user's reminders. Also capped at 200 filter policies per topic by default. | Rejected. Would still need the message to avoid personal details. |
| One topic with a Lambda subscriber doing per-user delivery | SNS cannot e-mail an arbitrary address: each address must subscribe to a topic and confirm. The Lambda would have to publish to per-user topics anyway (or use SES or SMS, which are excluded or have no phone numbers). | Rejected. It adds a hop and gains nothing. |

Per-user topics are created and deleted by the app at runtime (opt-in and opt-out), so they are not CloudFormation resources. Their names all start with `ClueNestReminders-<env>-`, which is what every IAM permission is limited to. Deleting the stack does not delete topics that users created (turn the setting off first, or delete them by name).

### How a user gets reminders

1. **Settings, "E-mail me maintenance reminders" switch** (the only part of Settings that is now real). Turning it on calls `PUT /notifications/preferences`.
2. `NotificationPreferencesFunction` reads the user's **verified e-mail from Cognito** (never from the request), creates their topic, and subscribes that address. SNS then sends a confirmation e-mail (from AWS Notifications) with a link. The status is **pending** and **nothing is sent**.
3. The user clicks the link. The subscription is now confirmed (status **active**). Pending subscriptions that are not confirmed expire after 48 hours (status **needs attention**; turning the switch off and on again sends a new one).
4. The daily check (`ClueNestMaintenanceReminders`, the existing EventBridge rule) finds due or overdue reminders, and for each user checks all of: opted in, the topic computed from the user ID has a **confirmed** e-mail subscription, and the reminder has not been notified for this due date. Only then does it publish ONE e-mail to that user's own topic.
5. **Unsubscribe:** turning the switch off records "off" first (delivery stops at once), then deletes the topic, which removes every subscription. Every e-mail also carries SNS's own unsubscribe link, which removes the address (the Settings screen then shows "needs attention").

A user who never opts in, never confirms, or has unsubscribed gets nothing. Their reminders are never read for delivery beyond the count.

### Stored data (existing table, no new table)

| Item | Key | Attributes | Written by |
|------|-----|------------|------------|
| Setting | `PK=USER#<sub>`, `SK=PREFS#notifications` | `p_maintenanceEmail` (true or false), `p_type`, `p_userId`, `p_requestedAt`, `p_updatedAt`, `p_lastSubscribeAt` | the API function |
| Notification ledger | `PK=USER#<sub>`, `SK=NOTIFY#<reminderId>#<dueDate>` | `n_state` (`sending`, `sent`, `failed`, `abandoned`), `n_attempts`, `n_leaseUntil`, `n_nextAttemptAt`, `n_sentAt`, `n_messageId`, `n_errorCode`, `n_type`, `n_userId`, `n_reminderId`, `n_dueDate`, `n_expiresAt` | the daily check |

The e-mail address is not stored. Reminders are never changed: `maintenance.py` is untouched and the ledger is separate items. Prefix `p_` and `n_` keep the IAM allow-lists from touching any reminder attribute.

### No duplicates, retries and concurrency

- Each reminder is claimed with ONE conditional write before sending: it succeeds only if there is no ledger item, or it failed and its retry time has passed (under 4 attempts), or an earlier run's 5 minute lease expired. Two runs at the same time cannot both claim it.
- The ledger is marked `sent` only AFTER SNS accepts the message, and only if the claim is still ours (state and attempt number). A failed publish marks it `failed` with a retry time (1 hour, then 4, then 16, never over a day), so the next daily run retries. After 4 attempts, or if the topic is gone, it becomes `abandoned`.
- `sent` and `abandoned` reminders are skipped for good (for that due date). Editing the due date makes a new key, so the user is told about the new date once.
- One e-mail has at most 25 reminders. The rest go out on the next run. A reminder that is still overdue a year later (ledger items expire by TTL after about a year) would be sent once more.
- Known limit: if a run crashes after SNS accepts the message but before it marks the ledger, one duplicate can follow once the lease ends. SNS has no idempotency key.

### Permissions (least privilege)

- `NotificationPreferencesRole`: logging; `dynamodb:GetItem` and `UpdateItem` limited to the `p_` attributes of the table (no Put, Delete, Query or Scan); `sns:CreateTopic`, `SetTopicAttributes`, `Subscribe`, `ListSubscriptionsByTopic`, `DeleteTopic` only on `ClueNestReminders-<env>-*`; `cognito-idp:AdminGetUser` on the one user pool. No `sns:Publish`.
- `MaintenanceReminderRole` (existing role, extended): `Scan` as before; `GetItem`, `Query`, `UpdateItem` limited to the `n_` attributes and `p_maintenanceEmail`; `sns:Publish` and `ListSubscriptionsByTopic` only on the per-user topic names. No Cognito, no Create, Subscribe or Delete.
- The shared role and the technician role gain nothing. A test checks that the IAM attribute lists equal the attribute names the code uses.
- The topic ARN is always computed from the user ID, never read from a request or the database.

### Infrastructure changes (one template, one stack)

New: `NotificationPreferencesFunction`, its role and log group, one integration, routes `GET` and `PUT /notifications/preferences` (scopes `cluenest-api/read` and `cluenest-api/write`, same authorizer), one invoke permission and one output. Changed in place: `MaintenanceReminderRole` and `MaintenanceReminderFunction` (new statements, `TOPIC_ARN_PREFIX` and `APP_URL`, 300 s, 256 MB), `ClueNestTable` (TTL on `n_expiresAt`) and the API stage's `DependsOn`. The existing EventBridge rule is reused. All Lambdas also get the new zip.

### Frontend change

Only the Settings screen. The maintenance row is now an e-mail switch with a status line (off, waiting for confirmation, on, needs attention). The warranty and repair rows stay browser-local prototypes and say so. `api.js` gains `getNotificationPreferences` and `setMaintenanceEmail`.

### Limits and things to know

- SNS e-mail is plain text, sent from "AWS Notifications", with SNS's footer. It cannot be branded.
- The confirmation e-mail may land in spam. Nothing is sent until it is clicked.
- If an address is reported as bouncing, SNS stops delivering to it, and the app is not told.
- Reminders are matched by UTC date. Delivery runs once a day (12:00 UTC), and retries wait for the next run.
- The topics are not encrypted with a custom key (SNS encrypts in transit). They carry only the user's own task and appliance names.
- Each opt-in creates one topic. The default account limit is 100,000 topics.
- If an account's e-mail is changed in Cognito later, the old address stays subscribed until the user turns the setting off and on.
- The `dynamodb:Attributes` conditions and the SNS calls have only been tested against fakes. **After deployment, check one opt-in by hand** (it sends one real confirmation e-mail to the account address), then one scheduled run.

### Cost (check current prices)

SNS: topics are free, and e-mail delivery has a small free allowance and then cents per 100,000. Lambda, EventBridge, Cognito reads and DynamoDB ledger writes are cents or less at development volume.
## Demo troubleshooting section

**Status: the backend is deployed to `dev` (code-only update of the 7 Lambda functions, stack `UPDATE_COMPLETE`, nothing added, removed or replaced). Verified live with a real hosted sign-in and 6 test appliances: demo answers for washing machine, refrigerator, dishwasher, air conditioner, oven and dryer, plus error code, unmatched description, gas and smoke wording, and the 401, 403, 400 and 404 cases. The hosted frontend still shows the old banner until `troubleshoot.js` is uploaded.** A temporary mode, because the account's Bedrock token quota is 0 (see "Bedrock section"). The Bedrock code is untouched and still tested.

### The switch

`troubleshoot.py` reads the environment variable `TROUBLESHOOT_MODE`:

| Value | What `POST /troubleshoot` does |
|-------|--------------------------------|
| `MOCK` (default, also when the variable is missing) | Returns a fixed, ready-made demo answer from `mock_troubleshooting.py`. Never calls Bedrock and needs no model ID. |
| `BEDROCK` | The original integration: Bedrock Converse with `BEDROCK_MODEL_ID`, answer checks, unsafe-step filter, errors when Bedrock fails. Never falls back to demo answers. |
| anything else | Treated as `MOCK` (and a warning is logged), so a typo can never start paid model calls. |

Values are not case sensitive. The template does not set `TROUBLESHOOT_MODE`, so a code-only deployment runs in MOCK mode.

### What a demo answer looks like

Same response shape as the real answer (`possibleCauses`, `recommendedSolutions`, `safetyWarnings`, `callProfessionalIf`), plus: `mode` = `mock`, `mock` = true, `demoLabel` (Demo Mode [em dash] Not AI-generated), `demoNotice`, `demoScope` (`specific` or `general`), `summary` and `repairVsReplace`. Safety warnings include the professional-help line and the "not a confirmed diagnosis" sentence.

- **Ready-made for:** washing machine, refrigerator, dishwasher, air conditioner and oven. The appliance type and the problem category pick one answer (about 35 answers). For "Not Working Properly" and "Other", a few words in the description (spin, frost, musty, cloudy, uneven and similar) pick a more specific one. The description itself is never copied into the answer.
- **Error Code:** never interpreted. There is no table of codes, so the answer says to use the manual and a power reset, and echoes the code once.
- **No match:** a general answer for that appliance type that says so. **Dryer, Microwave and Other** get general checks for any appliance, and say so.
- **Dangerous problems** (gas, smoke, sparks, exposed wiring, water near electrical parts) are answered first by the fixed safety rules (`mode` = `safety-rules`), exactly as before. They never become a demo answer.
- Every answer: only checks that are safe with the appliance off, no opening of panels or covers, no wiring, meters, gas or internal parts, no prices, no technician names, no contact details. A test checks all answers against these rules.
- Repair or replace guidance is general (typical lifespans, "check the warranty", "get a written quote", "use the Repair vs Replace screen"). It states no price.

### Frontend (Troubleshooting screen only)

`frontend/js/troubleshoot.js` shows the banner **Demo Mode [em dash] Not AI-generated** instead of the old "Prototype guidance (MOCK mode)" text, shows the `summary` line and a **Repair or Replace?** section when the answer has them, and exports two more names for tests. Real answers and safety-rule answers look the same as before. The page heading and button still say "AI" because they are shared with the real mode.

### Switching back to Bedrock

1. Get usable Bedrock quota and prove it with a real Converse call (see "Bedrock section").
2. Add `TROUBLESHOOT_MODE: BEDROCK` to the troubleshoot function's environment in the template (together with `BedrockModelId` / `BedrockBaseModelId`, which add the permission and `BEDROCK_MODEL_ID`) and deploy through a reviewed change set. This needs a small template edit that was deliberately not made now. Editing the variable in the Lambda console works for a test but CloudFormation will overwrite it at the next update.
3. Check that an answer comes back with `mode` = `bedrock` and no `demoLabel`.

### Limits

- The answers are generic. They do not use the brand, model, age or the user's description.
- The hosted site shows the demo content but with the old banner text and no summary or repair section until `troubleshoot.js` is uploaded to S3 and CloudFront is invalidated (separate approval).
- Anyone who later deploys with `BedrockModelId` set but without `TROUBLESHOOT_MODE=BEDROCK` will still get demo answers. They are clearly labelled.
## Validation results (Lambda step)

All run on the local files before the first deployment. This table covers the Lambda step. The Cognito step is validated in the next section.

| Check | Result |
|-------|--------|
| `cfn-lint` 1.57.0 on the master template | No findings. Also none with `--regions us-east-1` and with informational rules on. |
| `aws cloudformation validate-template` (us-east-1) | Passed. Needs `CAPABILITY_NAMED_IAM` (`AWS::IAM::Role` and `AWS::IAM::Policy`). Reports the three parameters. |
| Template size | About 13 KB at this step (about 35 KB after API Gateway; limit 51,200 bytes). |
| Duplicate keys and logical IDs | None. Names are unique per resource type for `dev`, `test` and `prod`, start with `ClueNest`, end in `-<env>`, and fit the length limits. |
| References, conditions, dependencies | Every `!Ref`, `!GetAtt`, `!Sub` variable and `!If` resolves. All 3 parameters and the condition are used. No circular dependencies. |
| Original configuration preserved | `ClueNestTable` is identical to before. `LambdaExecutionRole` is identical except its `Description` text, including the trust policy and managed policy. The `Environment` parameter, `IsProd` condition and the four original outputs are identical. |
| Lambda configuration vs code | Each handler exists in `lambda/src` with the `(event, context)` signature. `TABLE_NAME` is set exactly on the functions whose code uses the database. Every variable set is one the code reads. |
| IAM policy vs code | The actions the code calls (`GetItem`, `Query`, `PutItem`, `DeleteItem`) equal the policy's actions exactly. The code never calls `Scan`, `UpdateItem`, batch or management operations. Transactions contain only `Put` operations. |
| AWS policy simulator | The four actions are allowed on the ClueNest table. 32 other action and resource combinations are denied, including a different table, an index and the prod table. |
| Python | `pyflakes` clean. All files compile on Python 3.12.10. The deployed code imports only the standard library and `boto3`. |
| Unit tests | 87 tests pass on Python 3.12.10 (boto3 1.44.9, moto 5.2.5): 25 appliances, 21 maintenance, 12 repair history, 16 shared helpers, 7 placeholders, 6 security. |
| Packaging | A zip of the six files is about 15 KB. It passes an integrity test, contains no folders, tests or cache files, and all five handlers import and run from inside the zip. An unauthenticated call returns 401. |
| Frontend | Not modified (all 24 frontend files checked by hash). |

**What was not tested:** the code ran against an emulator of DynamoDB, not real DynamoDB. The stack has since been deployed and CloudFormation accepted the template, including the conditional `DeletionPolicy`. But no Lambda function has been invoked in AWS, so permissions, timeouts and cold starts are still untested.

## Validation results (Cognito step)

| Check | Result |
|-------|--------|
| `cfn-lint` 1.57.0 | No findings. Also none with `--regions us-east-1` and with informational rules on. This checks every Cognito property name and value against the AWS schema. |
| `aws cloudformation validate-template` | Passed. Lists the five parameters. |
| Template checks (74 automated checks) | No duplicate keys or IDs. Every reference resolves, no circular dependencies. All 8 existing resources, all existing parameters, the `IsProd` condition and all 9 existing outputs are identical to the deployed template. The only new resources are `UserPool` and `UserPoolClient`. No IAM resource was added or changed. |
| Cognito settings checks | Every setting in the tables above was asserted, for `dev`, `test` and `prod`: no client secret, code flow only, no federation, SRP and refresh only, token lifetimes within Cognito's limits, prod retained and protected. |
| Redirect URL pattern | Accepts `https` URLs and `http://localhost`. Rejects other `http` hosts, `127.0.0.1`, look-alike hosts such as `localhost.evil.com`, wildcards, fragments, other schemes, spaces and comma-separated lists. |
| Frontend compatibility | Every token claim read in `frontend/js/auth.js` is available from the client's read attributes and scopes. |
| Deployed template vs local | The template running in AWS before the update was identical to the local file. |
| Change set | Two changes, both `Add`: `UserPool` and `UserPoolClient`. No `Modify` and no `Remove`. Parameters were the values already deployed. |
| Update | `UPDATE_COMPLETE` in 33 seconds. Events show only the two Cognito resources. |
| Live read-back from AWS | The pool and client in AWS match the template on every setting listed above. The pool has 0 users, no domain, no triggers, no SMS and no MFA. |
| Everything else unchanged | The 5 Lambda functions have the same code hash and last-modified time as before. The DynamoDB table, IAM role, managed policy and DynamoDB policy are identical to before. |
| Issuer | The issuer's OpenID discovery document is reachable and its `issuer` equals the stack output. Two RS256 signing keys are published. |
| Frontend | Not modified (all frontend files checked by hash). |

Not tested: sign-up, email delivery, sign-in and token contents, because no hosted-UI domain exists and no user was created.

## Validation results (API Gateway step)

| Check | Result |
|-------|--------|
| `cfn-lint` | No findings (default, `--regions us-east-1`, informational rules on). |
| `aws cloudformation validate-template` | Passed with `CAPABILITY_NAMED_IAM`. |
| Template checks (159 automated) | All passed: 18 routes all JWT, authorizer issuer and audience, CORS, scoped permissions, existing resources unchanged. |
| Change set 1 | 32 `Add`, no `Modify`, no `Remove`. Update took 33 seconds. |
| Change set 2 | 1 `Modify` (`ApiStage` access log format), no replacement. See below. |
| Live read-back | API, stage, routes, integrations, authorizer, CORS and Lambda resource policies match the template. |
| Request tests without credentials (21 curl) | No, forged or malformed token gives 401. Unknown route or method gives 404. Preflight from the allowed origin gives 204 with CORS headers, other origins get none. Plain HTTP and TLS 1.1 refused, TLS 1.2 works. |
| End-to-end with real tokens (67 checks) | Create, read, update and delete for appliances, maintenance (including complete and repeat) and repair history. Placeholders return 501. A second user cannot see or change the first user's data. Forged `userId`, `PK` and `id` in bodies are ignored. Raw and `Bearer` ID and access tokens all work. |
| Access logs | 60 of 60 request lines are valid JSON with 12 fields. No token, password or email in API or Lambda logs. |
| Everything else unchanged | Lambda code hashes, DynamoDB table, IAM role and Cognito settings are the same as before. Frontend not modified. |

**Defect found and fixed.** The first access-log format included `$context.authorizer.error`. For forged tokens its text contains unescaped quotes, which produced invalid JSON. The field was removed (change set 2) and must not be re-added. The first end-to-end run exposed it. In the second run the only failure was a test that still expected 13 fields.

**Test users.** Two temporary Cognito users were created for the tests and deleted afterwards. The table has 0 items and the pool has 0 users. The test scripts are not part of the project.

Not tested: throttling under load, and calls from a real browser.
## Validation results (Secrets Manager step)

| Check | Result |
|-------|--------|
| `cfn-lint` | No findings (default and informational). |
| `aws cloudformation validate-template` | Passed (7 parameters). |
| Template size | About 42 KB of the 51.2 KB direct limit. |
| Python | `pyflakes` clean, compiles on Python 3.12. |
| Unit tests | 125 pass (109 before). The 16 new ones use moto's Secrets Manager and fake errors: no variable, empty container, unknown secret, key read but never returned or logged, JSON key, 9 unusable values, binary secret, cache hit and expiry, failures not cached, rotated key, 9 AWS and network errors giving a safe 503, AWS text not logged, validation and authentication before any secret call, no database needed, client timeouts. |
| Change set | 2 `Add` (`GooglePlacesSecret`, `TechnicianSearchRole`). 10 `Modify`, none replaced: the 5 functions (new code zip, the technician function also gets its role, variable, timeout 10 s and description) and their 5 API integrations (same function ARNs). No `Remove`. The shared role, DynamoDB, Cognito, API routes and authorizer, and `BedrockInvokePolicy` do not appear. |
| Update | `UPDATE_COMPLETE`. 44 resources, 20 outputs. |
| Live read-back | The secret exists with no versions (empty), default encryption and no rotation. The technician function has `GOOGLE_PLACES_SECRET_ARN` and the new role. The new role has the managed logging policy and the one scoped inline policy. The shared role is unchanged. |
| Policy simulator | See the IAM section above. |
| Function invoked directly (no secret value read) | Valid query: 501 `NOT_CONFIGURED`. The log shows `ResourceNotFoundException`, which proves the role may call `GetSecretValue` and the empty secret is handled. A denied call would have given 503. Bad query: 400. No claims: 401. Through the API, a call without a token still gives 401. |
| Secrets in logs and outputs | None. Logs contain only the error code. The three new outputs are the ARN, the name and the role ARN. |
| Frontend | Not modified. |

**Side effect to know about:** the same zip also carries the Bedrock code (Step 6). `POST /troubleshoot` therefore now applies the safety rules to dangerous wording, and answers 501 `NOT_CONFIGURED` for everything else, as before, because no Bedrock model is set.
## Validation results (technician search step)

| Check | Result |
|-------|--------|
| Unit tests | 145 pass (125 before). Google and Secrets Manager are faked, and a guard makes any unfaked Google call fail the test. New tests cover: successful search and result fields, fields left out when Google omits them, request URL, headers, bodies, field masks and timeouts, the search phrase list (including injection text), radius filtering and the bounding box, closed, duplicate and unnamed businesses, empty results, unknown location, cleaning of odd Google values, no coordinates, 401, 405, 10 invalid requests with no Secrets Manager or Google call, missing, empty, unusable and binary secrets, key never in URL, response or logs, 6 invalid-key cases, 5 quota cases, 6 service errors, 5 unreadable answers, timeouts on either call, other network failures, nothing sensitive in logs, and secret caching (3 searches, 1 Secrets Manager call, expiry, failures not cached). |
| `pyflakes`, compile | Clean on Python 3.12. |
| `cfn-lint` | No findings (default and informational). |
| `validate-template` | Passed. |
| Google field names | Checked against Google's Text Search (New) documentation. |
| Frontend | Not modified. Response shape matches what `find-technician.js` reads. |

**Not tested:** any real Google call. Field masks, the location lookup for postal codes, result quality and real latency are unverified until a first call after deployment.
## Validation results (hosted sign-in step)

| Check | Result |
|-------|--------|
| Frontend tests | 53 pass (`node --test "frontend/tests/*.test.js"`): login redirect and PKCE S256 challenge, fresh random values, sign-up redirect, successful callback and token request, no secret in the request, no `localStorage`, no refresh token stored, 6 bad-callback cases, 11 token mismatch cases, replay, user cancel, 5 token endpoint failures, timeout, session restore in the same tab only, expiry, damaged storage, sign out and logout URL, bad domain, no token in the console, Bearer access token on API and technician search calls, no call without a session, 401 ends the session, 403 does not, other errors keep it. |
| Real browser (Edge headless) | The sign-in screen shows when signed out. A forged callback shows "Sign-in could not be completed". |
| JavaScript syntax | All 20 files pass `node --check`. |
| Backend tests | 146 pass (no backend code changed). |
| `cfn-lint`, `validate-template` | Clean and passed. |
| Change set preview | One `Add` (`UserPoolDomain`). Created and deleted, not executed. |
| API without a token | 401 (checked earlier for every route). |

**Not tested:** a real sign-up, e-mail code, sign-in and an API call with a real Cognito token, because that needs a real account and e-mail (waiting for your approval). The hosted pages, the token endpoint's browser access and the logout redirect are untested until the domain exists.
## Validation results (API authorization step)

| Check | Result |
|-------|--------|
| Template tests (`python -m unittest discover -s backend/tests`) | 14 pass: 18 routes exactly as listed, all `JWT`, all with the right scope, no public or catch-all route, resource server scopes, client scopes and dependency, one pool, one client, one API, 5 functions, and the six-row table of the requirement run through a model of AWS's documented authorizer rules. |
| Backend tests | 147 pass (146 before): includes every handler refusing an ID token or a token without `token_use`. |
| Frontend tests | 59 pass (53 before): scopes in the login request, tokens without the API scopes rejected, old sessions dropped, 403 ends the session, the ID token is never sent. |
| JavaScript syntax | All 20 files pass `node --check`. |
| `cfn-lint`, `validate-template` | Clean and passed. |
| Change set preview (created, then deleted) | 18 `Modify` on routes (`AuthorizationScopes` only), 1 `Modify` on `UserPoolClient` (`AllowedOAuthScopes`, no replacement), 1 `Add` `UserPoolResourceServer`. Nothing else. |

**Live check after deployment** (a temporary user, created without e-mail and deleted afterwards, signed in through the real hosted pages with the code flow and PKCE): no token 401, forged token 401, ID token 403 (from both kinds of sign-in), access token without the API scopes 403, access token with the scopes 200 on appliances, maintenance, repair history and technician search (19 real results), create and delete an appliance with the scoped token 201 and 200, and a write call with an ID token or an unscoped token 403. The hosted access token carries exactly `cluenest-api/read` and `cluenest-api/write`, and the hosted ID token has no `scope` claim. **Not tested live:** an expired access token (tokens last 60 minutes). It is 401 by the documented rules.
## Validation results (frontend hosting step)

| Check | Result |
|-------|--------|
| `cfn-lint` | No findings (default, `--regions us-east-1`, informational). |
| `validate-template` | Passed through `--template-url` (the template is over the direct-upload limit). 8 parameters. |
| Template tests | 37 pass in `backend/tests` (23 new): private bucket, encryption, ownership, versioning, bucket policy scope, OAC and S3 REST origin, https redirect, price class, cache key, security headers, error pages, hash routing, Cognito URLs and OAuth settings, API CORS, 18 routes and the authorizer untouched, no duplicate keys, every reference resolves, no circular dependency, the distribution does not depend on Cognito or the API, and exactly 5 resources added and none removed. |
| Backend tests | 147 pass (no backend code changed). |
| Frontend tests | 64 pass (5 new for `config.js`). All 20 JavaScript files pass `node --check`. |
| Change set (created, not executed) | 5 `Add` (the five hosting resources), 2 `Modify` in place (`UserPoolClient` URLs, `HttpApi` CORS). No `Remove`, no replacement. |

**Not tested:** the real distribution, the bucket policy in AWS, a sign-in on the CloudFront address and CORS from it. They need the deployment and an upload.
## Validation results (EventBridge step)

| Check | Result |
|-------|--------|
| `cfn-lint` | No findings (default, `--regions us-east-1`, informational). |
| `validate-template` | Passed through `--template-url` (the template is about 59 KB, over the direct limit). 8 parameters. |
| Template tests | 52 pass (`backend/tests`, 22 new): one enabled daily rule at 12:00 UTC, one target with limited retries, the invoke permission scoped to that rule, the function settings, no API route or integration reaches it, role and policy are Scan only on the table, the shared role still cannot scan, no SNS, SES or other new services, outputs, Bedrock still off, 18 routes unchanged, no circular references, and a comparison with the previous template proving every existing resource is identical and exactly five resources were added. |
| Backend tests | 157 pass (10 new for the reminder check, using a DynamoDB emulator): counts only pending reminders due today or overdue, the date boundary, an empty table, nothing is ever written, only `Scan` with a minimal projection, many pages give the same answer, an early stop is reported, only the schedule event is accepted, no personal data in logs or results, and the maintenance API is unchanged. |
| Frontend tests | 64 pass (no frontend change). |
| Change set (created, not executed) | 5 `Add` (rule, function, permission, role, log group). 10 `Modify`, none replaced: the 5 API functions (new zip) and their 5 integrations. No `Remove`. |

**Not tested:** the real rule firing, the deployed role's `Scan` permission and a real scan of the table. They need the deployment.
## Validation results (SNS notifications step)

| Check | Result |
|-------|--------|
| `cfn-lint` | No findings (default, `--regions us-east-1`, informational). |
| `validate-template` | Passed through `--template-url` (the template is about 69 KB). 8 parameters. |
| Backend tests | 193 pass (36 new, SNS and Cognito faked, DynamoDB emulated): 15 for the setting (default off, subscribe the Cognito address only, pending until confirmed, no second confirmation e-mail, unverified or disabled accounts refused, rate limit, turning off stops delivery first, users isolated, validation, AWS errors hidden, nothing personal stored or logged) and 21 for delivery (nothing before opt-in or confirmation, only the user's own reminders and topic, never twice, a new due date once, completed and future reminders skipped, retry then success, giving up, vanished topic, concurrent claims, a late finish cannot overwrite a newer claim, the 25 limit, topic always from the user ID, opt-out, one user's failure, ledger attributes, counts only when delivery is off, no personal data in logs). |
| Template tests | 72 pass (20 new in `backend/tests/test_template_sns.py`): no shared topic, no filter policy, every SNS permission limited to the per-user names, role statements, IAM attribute lists equal to the attribute names in the code, routes and scopes, TTL only on the ledger attribute, and a comparison with the previous template proving only the intended resources changed. |
| Frontend tests | 69 pass (5 new): Bearer access token on both calls, only true or false is sent and never an address, unknown server values read as off, server messages shown, status texts. |
| `pyflakes`, JavaScript syntax | Clean. |

**Not tested:** a real SNS subscription, confirmation e-mail or publish, the real IAM attribute conditions, and TTL deletion. They need the deployment and one opt-in by a real account.
## Validation results (demo troubleshooting step)

| Check | Result |
|-------|--------|
| Backend tests | 213 pass (20 new, plus the 22 Bedrock tests now run with `TROUBLESHOOT_MODE=BEDROCK`). New: every one of 5 appliances x 8 categories gives a complete, labelled demo answer; the matching answer for specific problems and description words; description never copied; general answers say so; Dryer, Microwave and Other; error codes never interpreted; no unsafe step, price, phone number or link in any answer; warnings only mention opening or touching parts to forbid it; dangerous problems get the safety rules; validation, authentication and ownership still apply; nothing saved or logged; MOCK never calls Bedrock even with a model ID set; unknown values mean MOCK; BEDROCK mode uses the original integration, never falls back to demo, hazards still use the rules. |
| Frontend tests | 78 pass (9 new): demo answer recognised and never shown as Bedrock, exact label, all sections and numbered steps, no demo label for real or safety-rule answers, text escaped, older response shape still works, request unchanged. |
| Real browser (Edge, local site) | With the real demo answer from the backend code: the Troubleshooting form works, the banner shows the label, the summary, safety warnings, 4 causes, 5 numbered steps, Repair or Replace and the decision buttons appear, no console errors, the request is unchanged. |
| Package | The Lambda zip would hold 12 files including `mock_troubleshooting.py`, and all 7 handlers import from inside it. |
| Template tests, `cfn-lint`, `pyflakes`, JavaScript syntax | 72 pass (3 skipped by design), clean, clean, clean. The template is unchanged. |
## Not implemented and open points

- **The Google Places search is not deployed yet** (see the Technician search section), and it has never been called against the real Google API. The first real call should be made by hand after deployment.
- **Bedrock is NOT enabled.** The code is deployed (it shipped in the same zip as Secrets Manager) but `BedrockModelId` is empty, because the account has zero Bedrock token quota (see "Bedrock section"). Dangerous-problem wording is answered by the safety rules. Everything else answers 501 until a model with usable quota is verified and the stack is updated with `BedrockModelId`.
- **The frontend is not connected.** It has no `apiBaseUrl` / `technicianSearchPath` config yet. Browser calls need the Cognito token in the `Authorization` header.
- **No Cognito domain and no login code yet,** so no real token can be obtained from the browser.
- **No routes for quotes, warranty check or repair-vs-replace.** Quotes have no Lambda. The other two run in the browser.
- **CORS allows only the `localhost` origin** derived from `FrontendCallbackUrl`. Change that parameter for the real site.
- **Throttle values (20 requests/s, burst 40 per route) were not load-tested.**
- **Lambda log groups have no retention** (created by Lambda on first call, not by the template).
- **The template is over the direct-upload size limit** (about 54 KB of 51.2 KB). Always deploy with `--s3-bucket <bucket>`.
- **No real sign-in has been tried yet.** The domain exists. Create an account at http://localhost:5500/ to test it (see "Cognito hosted sign-in section").
- **The sign-up form asks for a first name,** and that cannot be changed later without replacing the pool (see "Decision to confirm").
- **Cognito's built-in email is limited** to about 50 messages a day. Amazon SES is needed before real users.
- **The redirect URLs are `localhost` defaults.** Replace them with the real `https` website address before real users sign in.
- **`test` and `prod` have never been deployed.**
- **Technician quotes have no function yet.** Troubleshooting history is not stored yet.
- **The frontend still uses browser storage** for maintenance, repair history and quotes.
- **A code bucket is a deployment prerequisite** (see Packaging).
- **No duplicate protection on create.** If a network failure makes the app retry a `POST`, a second item can be created. An idempotency key could be added later.
- **No per-user item limits.** Throttling is per route, not per user.
- **Deleting an appliance keeps its reminders and repair records.** The copied appliance name keeps them readable. Whether to remove them is a product decision.
- **Copied appliance names can go stale** if the appliance is renamed later.
- **List calls return at most 1000 items** and have no paging cursor.
- **Lambda log retention** is unmanaged until the CloudWatch step. API access logs are managed (30 days, 90 in prod).

## Superseded files

`cloudformation/iam.yaml` and `cloudformation/database.yaml` were the first versions, one per step.
Their resources now live in `cluenest-infrastructure.yaml`, so **they are superseded and must not be deployed**.
They have not been changed and are kept only so the new template can be compared against them. They will be removed once you have verified the master template.
The stack names and deployment commands from those two files (`cluenest-iam-dev`, `cluenest-database-dev`) no longer apply.
