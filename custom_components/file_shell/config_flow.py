from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback

DOMAIN = "file_shell"
CONF_BASE_DIR = "base_dir"


class FileShellConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        return FileShellOptionsFlow()

    async def async_step_user(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> config_entries.ConfigFlowResult:

        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            base_dir = str(user_input.get(CONF_BASE_DIR) or "").strip()

            return self.async_create_entry(
                title="File Shell",
                data={
                    CONF_BASE_DIR: base_dir,
                },
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Optional( CONF_BASE_DIR, description={"suggested_value": self.hass.config.path()}, ): vol.Maybe(str),
                }
            ),
        )

    async def async_step_import(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> config_entries.ConfigFlowResult:
        """YAML import."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        return self.async_create_entry(
            title="File Shell",
            data={
                CONF_BASE_DIR: "",
            },
        )



class FileShellOptionsFlow(config_entries.OptionsFlow):

    async def async_step_init(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> config_entries.ConfigFlowResult:
        current_base_dir = str(
            self.config_entry.options.get(
                CONF_BASE_DIR,
                self.config_entry.data.get(CONF_BASE_DIR, self.hass.config.path()),
            )
            or self.hass.config.path()
        )

        if user_input is not None:
            base_dir = str(user_input.get(CONF_BASE_DIR) or "").strip()

            new_options = dict(self.config_entry.options)

            if base_dir:
                new_options[CONF_BASE_DIR] = base_dir
            else:
                new_options.pop(CONF_BASE_DIR, None)

            return self.async_create_entry(
                title="",
                data=new_options,
            )

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(CONF_BASE_DIR, description={"suggested_value": current_base_dir},): vol.Maybe(str),
                }
            ),
        )