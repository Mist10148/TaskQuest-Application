from __future__ import annotations

import ssl

import certifi

from app.config import Settings
from app.db.pool import ssl_context


def _first_pem() -> str:
    text = open(certifi.where(), encoding="ascii").read()
    end = "-----END CERTIFICATE-----"
    start = text.index("-----BEGIN CERTIFICATE-----")
    return text[start : text.index(end, start) + len(end)] + "\n"


def test_no_tls_by_default():
    assert ssl_context(Settings(db_ssl=False)) is None


def test_tls_verifies_by_default():
    ctx = ssl_context(Settings(db_ssl=True))
    assert ctx is not None
    assert ctx.verify_mode == ssl.CERT_REQUIRED
    assert ctx.check_hostname


def test_custom_ca_is_trusted_even_with_escaped_newlines():
    pem = _first_pem()
    plain = ssl_context(Settings(db_ssl=True, db_ssl_ca=pem))
    escaped = ssl_context(Settings(db_ssl=True, db_ssl_ca=pem.replace("\n", "\\n")))
    for ctx in (plain, escaped):
        assert ctx is not None
        assert ctx.verify_mode == ssl.CERT_REQUIRED
        assert any(cert for cert in ctx.get_ca_certs())


def test_reject_unauthorized_false_disables_checks():
    ctx = ssl_context(Settings(db_ssl=True, db_ssl_reject_unauthorized=False))
    assert ctx is not None
    assert ctx.verify_mode == ssl.CERT_NONE
    assert not ctx.check_hostname


def test_aiomysql_can_escape_blob_parameters():
    """Guards the PyMySQL pin: embeddings and checkpoints are sent to MySQL as bytes."""
    from aiomysql.connection import Connection

    assert Connection.escape(None, b"\x00ab") == r"_binary'\0ab'"  # type: ignore[arg-type]
