"""Settings for outgoing Telegram episode, event and test notifications."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator


class TelegramSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    include_poster: bool = True
    message_thread_id: int | None = Field(default=None, gt=0)
    disable_notification: bool | None = Field(
        default=None,
        description="Silent delivery. Unset preserves the episode, event and test defaults.",
    )
    protect_content: bool | None = None
    parse_mode: Literal["HTML", "MarkdownV2", "Markdown"] | None = None
    reply_markup: dict[str, JsonValue] | None = None
    text_parameters: dict[str, JsonValue] = Field(
        default_factory=dict,
        description="Additional sendMessage options, such as link_preview_options.",
    )
    photo_parameters: dict[str, JsonValue] = Field(
        default_factory=dict,
        description="Additional sendPhoto options, such as has_spoiler.",
    )

    @field_validator("text_parameters", "photo_parameters")
    @classmethod
    def check_additional_parameters(
        cls, value: dict[str, JsonValue]
    ) -> dict[str, JsonValue]:
        reserved = {
            "chat_id",
            "text",
            "caption",
            "photo",
            "method",
        } | cls.model_fields.keys()
        if conflicts := sorted(reserved.intersection(value)):
            raise ValueError(
                f"These fields are set by the provider or its shared settings: {', '.join(conflicts)}"
            )
        return value

    def send_parameters(self, *, photo: bool = False) -> dict:
        shared = {
            "message_thread_id": self.message_thread_id,
            "disable_notification": self.disable_notification,
            "protect_content": self.protect_content,
            "parse_mode": self.parse_mode,
            "reply_markup": self.reply_markup,
        }
        additional = self.photo_parameters if photo else self.text_parameters
        return {k: v for k, v in shared.items() if v is not None} | additional
