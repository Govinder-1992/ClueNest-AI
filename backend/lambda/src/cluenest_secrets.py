"""Reads secrets from AWS Secrets Manager for the ClueNest AI Lambda functions.
(Named cluenest_secrets because "secrets" is a Python standard library module.)
Rules:
  * The secret is identified by an ARN or name that comes from an environment variable. The value
    is never in the template, the code or the environment.
  * A successful read is cached in memory for CACHE_SECONDS, so a busy function does not call
    Secrets Manager on every request, and a changed secret is picked up within that time.
    Failures are never cached, so a secret that is entered after deployment works at once.
  * The value is never logged. Error messages from AWS are never logged or returned, only the
    error code.
"""
import logging
import time
import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

LOG = logging.getLogger()
CACHE_SECONDS = 300
_client = None
_cache = {}                      # secret id -> (time it expires, value)


class SecretNotSet(Exception):
    """The secret exists but has no usable value yet (or does not exist)."""


class SecretUnavailable(Exception):
    """Secrets Manager could not be reached, or access was refused."""


def client():
    global _client
    if _client is None:
        _client = boto3.client("secretsmanager", config=Config(
            connect_timeout=2, read_timeout=2, retries={"total_max_attempts": 2, "mode": "standard"}))
    return _client


def get_secret_string(secret_id):
    """The secret's text value. Raises SecretNotSet or SecretUnavailable, never anything else."""
    now = time.monotonic()
    cached = _cache.get(secret_id)
    if cached and cached[0] > now:
        return cached[1]
    try:
        reply = client().get_secret_value(SecretId=secret_id)
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        LOG.warning("Secrets Manager error: %s", code)
        if code == "ResourceNotFoundException":              # no such secret, or a secret with no value yet
            raise SecretNotSet()
        raise SecretUnavailable()
    except BotoCoreError as error:                           # timeout, connection problem
        LOG.warning("Secrets Manager error: %s", type(error).__name__)
        raise SecretUnavailable()
    value = reply.get("SecretString")
    if not isinstance(value, str) or not value.strip():      # empty, or a binary secret
        raise SecretNotSet()
    _cache[secret_id] = (now + CACHE_SECONDS, value)
    return value
