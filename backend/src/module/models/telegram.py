"""Persisted operator settings for the built-in Telegram channel."""

from pydantic import BaseModel, ConfigDict, Field, JsonValue

METHOD_PATTERN = r"^[A-Za-z][A-Za-z0-9]*$"


class TelegramAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    method: str = Field(pattern=METHOD_PATTERN)
    parameters: dict[str, JsonValue] = Field(default_factory=dict)


class TelegramEpisodeAction(TelegramAction):
    attach_poster: bool = Field(
        default=False, description="Supply the cached poster as multipart part 'poster'"
    )


class TelegramSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    test_environment: bool = False
    text_parameters: dict[str, JsonValue] = Field(
        default_factory=dict, description="Overrides for ordinary sendMessage delivery"
    )
    photo_parameters: dict[str, JsonValue] = Field(
        default_factory=dict, description="Overrides for ordinary sendPhoto delivery"
    )
    episode: TelegramEpisodeAction | None = None
    event: TelegramAction | None = None
