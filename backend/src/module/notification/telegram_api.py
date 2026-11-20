"""Telegram Bot API wire protocol, shared by notifications and explicit calls."""

import json
import logging
import re
from collections.abc import AsyncGenerator, AsyncIterable
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any
from urllib.parse import quote, urlsplit

import httpx2

from module.network.request_url import get_shared_client

METHOD_PATTERN = r"^[A-Za-z][A-Za-z0-9]*$"
DEFAULT_SERVER = "https://api.telegram.org"

# HTTPX logs the complete URL at INFO. Suppress that record only for the
# task sending bot credentials, including when tools change the log level.
_sending = ContextVar("sending_telegram_request", default=False)
logging.getLogger("httpx2").addFilter(lambda _: not _sending.get())

type Uploads = dict[str, tuple[str, bytes, str]]


class TelegramError(Exception):
    """Public error text is safe for a test response. Preserve Telegram rejections."""

    def __init__(self, message: str, status: int = 502, envelope: dict | None = None):
        super().__init__(message)
        self.status = status
        self.envelope = envelope


class TelegramBotAPI:
    def __init__(self, token: str, server: str = "", test_environment: bool = False):
        if not re.fullmatch(r"[A-Za-z0-9_:-]+", token):
            raise TelegramError("A Telegram bot token is required.", 422)
        server = server.rstrip("/") or DEFAULT_SERVER
        try:
            parts = urlsplit(server)
            valid = (
                parts.scheme in {"http", "https"}
                and parts.hostname
                and parts.username is None
                and parts.password is None
                and not parts.query
                and not parts.fragment
                and "\\" not in server
                and not any(char.isspace() for char in server)
                and (parts.scheme == "https" or parts.hostname != "api.telegram.org")
            )
            # Also validate the port and path as parsed by our HTTP client.
            httpx2.URL(server)
        except ValueError, httpx2.InvalidURL:
            valid = False
        if not valid:
            raise TelegramError("Invalid Telegram Bot API server URL.", 422)
        self._token = token
        self._server = server
        self._suffix = "/test" if test_environment else ""

    def _url(self, method: str) -> str:
        if not re.fullmatch(METHOD_PATTERN, method):
            raise TelegramError("Invalid Telegram method name.", 422)
        return f"{self._server}/bot{self._token}{self._suffix}/{method}"

    async def call(
        self,
        method: str,
        parameters: dict | None = None,
        *,
        files: Uploads | None = None,
    ) -> dict:
        """Encode typed parameters once. A multipart string may name an attach:// part."""
        parameters = parameters or {}
        if files:
            fields = {
                key: value
                if isinstance(value, str)
                else json.dumps(value, ensure_ascii=False)
                for key, value in parameters.items()
            }
            return await self._post(method, data=fields, files=files)
        return await self._post(method, json=parameters)

    async def submit_form(
        self,
        method: str,
        body: AsyncIterable[bytes],
        content_type: str,
        content_length: str | None,
    ) -> dict:
        """Relay form parts with backpressure, retaining filenames and the boundary."""
        headers = {"Content-Type": content_type}
        if content_length is not None:
            headers["Content-Length"] = content_length
        return await self._post(method, content=body, headers=headers)

    async def _post(self, method: str, **kwargs: Any) -> dict:
        url = self._url(method)
        # The reference Bot API server can hold getUpdates for up to 50 s.
        # Allow extra time for TLS/proxy overhead and server-side file operations.
        timeout = httpx2.Timeout(
            90.0 if method.lower() == "getupdates" else 60.0, connect=10, pool=10
        )
        client = await get_shared_client()
        try:
            with _sending.set(True):
                response = await client.post(
                    url, follow_redirects=False, timeout=timeout, **kwargs
                )
        except httpx2.TimeoutException:
            raise TelegramError(
                "Telegram request timed out. Delivery is unknown.", 504
            ) from None
        except httpx2.HTTPError:
            raise TelegramError(
                "Telegram transport failed. Delivery is unknown."
            ) from None
        try:
            envelope = response.json()
        except ValueError, UnicodeError:
            envelope = None
        if isinstance(envelope, dict):
            if (
                response.is_success
                and envelope.get("ok") is True
                and "result" in envelope
            ):
                return envelope
            if envelope.get("ok") is False and isinstance(
                envelope.get("description"), str
            ):
                description = envelope["description"].replace(self._token, "[redacted]")
                raise TelegramError(
                    description,
                    response.status_code,
                    {**envelope, "description": description},
                )
        raise TelegramError("Invalid response from the Telegram Bot API.")

    async def get_file_path(self, file_id: str) -> str:
        result = (await self.call("getFile", {"file_id": file_id}))["result"]
        path = result.get("file_path") if isinstance(result, dict) else None
        if not isinstance(path, str) or not path:
            raise TelegramError("Telegram did not return a downloadable file path.")
        return path

    @asynccontextmanager
    async def download(self, path: str) -> AsyncGenerator[httpx2.Response]:
        """Open a relative getFile path on the configured Telegram file endpoint."""
        if (
            any(part in {"", ".", ".."} for part in path.split("/"))
            or "\\" in path
            or any(ord(char) < 32 for char in path)
        ):
            raise TelegramError("Invalid Telegram file path.")
        url = f"{self._server}/file/bot{self._token}{self._suffix}/{quote(path)}"
        client = await get_shared_client()
        try:
            with _sending.set(True):
                async with client.stream(
                    "GET", url, follow_redirects=False
                ) as response:
                    if not response.is_success:
                        raise TelegramError("Telegram file download failed.")
                    yield response
        except httpx2.TimeoutException:
            raise TelegramError("Telegram file download timed out.", 504) from None
        except httpx2.HTTPError:
            raise TelegramError("Telegram file download failed.") from None
