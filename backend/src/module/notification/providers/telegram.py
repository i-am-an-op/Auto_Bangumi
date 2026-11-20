"""Send AutoBangumi notifications as Telegram messages or captioned posters."""

import json
import logging
import re
from contextvars import ContextVar
from html import escape as escape_html
from mimetypes import guess_type
from pathlib import PurePath
from typing import TYPE_CHECKING, Literal

import httpx2

from module.models.bangumi import Notification
from module.models.config import TelegramProviderConfig
from module.network.request_url import get_shared_client
from module.notification.base import NotificationProvider
from module.utils import load_image, load_poster_url

if TYPE_CHECKING:
    from module.models.config import NotificationProvider as ProviderConfig

logger = logging.getLogger(__name__)
# HTTPX includes the complete URL in its INFO record. The bot token is in
# the path, so suppress that record only in the task doing a Telegram send.
_sending = ContextVar("telegram_notification_send", default=False)
logging.getLogger("httpx2").addFilter(lambda _: not _sending.get())


class TelegramDeliveryError(Exception):
    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code


class TelegramProvider(NotificationProvider):
    def __init__(self, config: ProviderConfig):
        super().__init__(config)
        self._token = config.token
        self.chat_id = config.chat_id
        self.options = TelegramProviderConfig.model_validate(config).telegram

    def _escape_text(self, value: str) -> str:
        mode = self.options.parse_mode
        if mode == "HTML":
            return escape_html(value)
        if mode == "MarkdownV2":
            return re.sub(r"([_*\[\]()~`>#+\-=|{}.!\\])", r"\\\1", value)
        if mode == "Markdown":
            return re.sub(r"([_*`\[])", r"\\\1", value)
        return value

    async def _post(
        self,
        method: Literal["sendMessage", "sendPhoto"],
        payload: dict,
        photo: tuple[str, bytes, str] | None = None,
    ) -> None:
        if (
            not re.fullmatch(r"[a-zA-Z0-9_:-]+", self._token)
            or not self.chat_id.strip()
        ):
            raise TelegramDeliveryError(
                "A Telegram bot token and chat ID are required."
            )
        url = f"https://api.telegram.org/bot{self._token}/{method}"
        client = await get_shared_client()
        try:
            with _sending.set(True):
                if photo is None:
                    response = await client.post(
                        url, json=payload, follow_redirects=False
                    )
                else:
                    # Telegram expects nested fields as JSON strings in multipart.
                    fields = {
                        k: v
                        if isinstance(v, str)
                        else json.dumps(v, ensure_ascii=False)
                        for k, v in payload.items()
                    }
                    response = await client.post(
                        url, data=fields, files={"photo": photo}, follow_redirects=False
                    )
        except httpx2.RequestError:
            raise TelegramDeliveryError(
                "Could not confirm delivery to Telegram."
            ) from None
        try:
            result = response.json()
        except ValueError:
            result = None
        if isinstance(result, dict):
            if (
                response.is_success
                and result.get("ok") is True
                and isinstance(result.get("result"), dict)
            ):
                return
            if result.get("ok") is False and isinstance(result.get("description"), str):
                raise TelegramDeliveryError(
                    result["description"].replace(self._token, "[redacted]"),
                    result.get("error_code"),
                )
        raise TelegramDeliveryError(
            f"Unexpected Telegram response (HTTP {response.status_code})."
        )

    async def _send_text(self, text: str, *, test: bool = False) -> None:
        payload = self.options.send_parameters()
        if not test:
            payload.setdefault("disable_notification", True)
        await self._post(
            "sendMessage", {**payload, "chat_id": self.chat_id, "text": text}
        )

    async def _try_photo(
        self, payload: dict, photo: tuple[str, bytes, str] | None = None
    ) -> bool:
        try:
            await self._post("sendPhoto", payload, photo)
            return True
        except TelegramDeliveryError as exc:
            if exc.code == 400:
                # Telegram rejected the photo, so another source can be tried.
                return False
            raise

    async def _send_poster(self, path: str | None, caption: str) -> bool:
        payload = {
            "chat_id": self.chat_id,
            "caption": caption,
            "disable_notification": True,
            **self.options.send_parameters(photo=True),
        }
        source = await load_poster_url(path)
        if source and await self._try_photo({**payload, "photo": source}):
            return True
        if image := await load_image(path):
            filename = PurePath(path or "poster.jpg").name
            return await self._try_photo(
                payload,
                (
                    filename,
                    image,
                    guess_type(filename)[0] or "application/octet-stream",
                ),
            )
        return False

    async def send(self, notification: Notification) -> bool:
        text = self._format_message(
            notification, escape=self._escape_text if self.options.parse_mode else None
        )
        try:
            if self.options.include_poster and await self._send_poster(
                notification.poster_path, text
            ):
                return True
            await self._send_text(text)
            return True
        except TelegramDeliveryError as exc:
            logger.warning("Telegram episode delivery failed (code %s)", exc.code)
            return False

    async def _deliver_text(self, title: str, body: str) -> bool:
        try:
            await self._send_text(self._escape_text(f"{title}\n{body}"))
            return True
        except TelegramDeliveryError as exc:
            logger.warning("Telegram event delivery failed (code %s)", exc.code)
            return False

    async def test(self) -> tuple[bool, str]:
        try:
            await self._send_text(
                self._escape_text(
                    "AutoBangumi 通知测试成功！\nNotification test successful!"
                ),
                test=True,
            )
            return True, "Telegram test message sent successfully"
        except TelegramDeliveryError as exc:
            return False, f"Telegram test failed: {exc}"
