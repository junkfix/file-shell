from __future__ import annotations

import asyncio
import contextlib
import logging
import gzip
import os
import shutil
import struct
import subprocess
import tarfile
import zipfile
import termios
import json
import yaml
import ast

from collections.abc import Callable
from pathlib import Path
from typing import Any

from aiohttp import web
from atomicwrites import AtomicWriter

from homeassistant import config_entries
from homeassistant.components import frontend
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

NAME = "File Shell"
DOMAIN = "file_shell"
DOMAIN_REG = "file_shell_reg"
CONF_BASE_DIR = "base_dir"

_LOGGER = logging.getLogger(__name__)

try:
    import pty
    import fcntl
    PTY = True
except ImportError:
    PTY = False

def json_error(message: str, status: int = 400) -> web.Response:
    return web.json_response({"ok": False, "error": message}, status=status)


def json_ok(**data: Any) -> web.Response:
    return web.json_response({"ok": True, **data})


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Import YAML config if file_shell: exists in configuration.yaml."""
    if DOMAIN in config:
        hass.async_create_task(
            hass.config_entries.flow.async_init(
                DOMAIN,
                context={"source": config_entries.SOURCE_IMPORT},
                data={},
            )
        )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if hass.data.get(DOMAIN_REG):
        hass.data[DOMAIN] = entry
        return True

    www_dir = Path(__file__).parent / "www"
    latest = max((p.stat().st_mtime for name in (DOMAIN + ".html", DOMAIN + ".js", DOMAIN + ".css") if (p := www_dir / name).exists()), default=1)

    await hass.http.async_register_static_paths(
        [StaticPathConfig(url_path=f"/local/{DOMAIN}", path=str(www_dir), cache_headers=False)]
    )
    frontend.async_register_built_in_panel(
        hass,
        component_name="iframe",
        sidebar_title=NAME,
        sidebar_icon="mdi:folder-edit",
        frontend_url_path=DOMAIN,
        config={"url": f"/local/{DOMAIN}/{DOMAIN}.html?v={int(latest)}"},
        require_admin=True,
    )

    hass.http.register_view(FileShellApiView(hass, entry))
    hass.http.register_view(FileShellStreamView(hass, entry))
    hass.http.register_view(FileShellTerminalView(hass, entry))
    entry.async_on_unload(entry.add_update_listener(async_update_options))
    hass.data[DOMAIN_REG] = True
    return True


async def async_update_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    frontend.async_remove_panel(hass, DOMAIN)
    hass.data.pop(DOMAIN_REG, None)
    hass.data.pop(DOMAIN, None)
    return True


class FileShellBase:
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry

    @property
    def base_dir(self) -> Path:
        configured = str(
            self.entry.options.get(CONF_BASE_DIR, self.entry.data.get(CONF_BASE_DIR, "")) or ""
        ).strip()
        if not configured:
            return Path(self.hass.config.path()).resolve()

        path = Path(configured).expanduser()
        if not path.is_absolute():
            path = Path(self.hass.config.path(configured))
        return path.resolve()

    def _assert_inside(self, path: Path, message: str = "Path traversal is not allowed") -> Path:
        try:
            path.relative_to(self.base_dir)
        except ValueError as err:
            raise web.HTTPForbidden(text=message) from err
        return path

    def _child_path(self, raw_path: str | None, *, resolve: bool) -> Path:
        raw = str(raw_path or "").strip().lstrip("/")
        path = self.base_dir if not raw else self.base_dir / raw
        return path.resolve() if resolve else path

    def _get_unresolved_resolved(self, raw_path: str | None) -> tuple[Path, Path]:
        unresolved = self._child_path(raw_path, resolve=False)
        resolved = unresolved.resolve()
        self._assert_inside(resolved)
        return unresolved, resolved

    def safe_path(self, raw_path: str | None) -> Path:
        return self._assert_inside(self._child_path(raw_path, resolve=True))

    def display_path(self, path: Path) -> str:
        path = path.resolve() if not path.is_symlink() else path
        if path == self.base_dir:
            return "/"
        rel = str(path.relative_to(self.base_dir)).strip("/")
        return f"/{rel}" if rel else "/"

    def _path_in_base(self, path: Path, message: str) -> web.Response | None:
        try:
            path.relative_to(self.base_dir)
        except ValueError:
            return json_error(message, 403)
        return None

    def _non_empty_paths(self, data: dict[str, Any]) -> list[Any] | web.Response:
        paths = data.get("paths")
        return paths if isinstance(paths, list) and paths else json_error("'paths' must be a non-empty list", 400)

    def _valid_name(self, name: Any, missing: str, invalid: str) -> str | web.Response:
        value = str(name or "").strip()
        if not value:
            return json_error(missing, 400)
        if "/" in value or "\\" in value:
            return json_error(invalid, 400)
        return value

    async def _run(self, func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        if kwargs:
            return await self.hass.async_add_executor_job(lambda: func(*args, **kwargs))
        return await self.hass.async_add_executor_job(func, *args)

    async def _run_json(
        self,
        func: Callable[..., Any],
        *args: Any,
        permission_msg: str = "Permission denied",
        oserror_status: int = 500,
        extra_errors: tuple[tuple[type[BaseException] | tuple[type[BaseException], ...], str | None, int], ...] = (),
        **kwargs: Any,
    ) -> tuple[Any | None, web.Response | None]:
        try:
            return await self._run(func, *args, **kwargs), None
        except Exception as err:  # checked in specificity order
            if isinstance(err, PermissionError):
                return None, json_error(permission_msg, 403)
            for exc_type, message, status in extra_errors:
                if isinstance(err, exc_type):
                    return None, json_error(message or str(err), status)
            if isinstance(err, OSError):
                return None, json_error(str(err), oserror_status)
            raise

    async def list_directory(self, directory: Path) -> list[dict[str, Any]]:
        base = self.base_dir

        def scan() -> list[dict[str, Any]]:
            entries: list[dict[str, Any]] = []
            with os.scandir(directory) as iterator:
                for item in iterator:
                    try:
                        is_symlink = item.is_symlink()
                        stat = item.stat(follow_symlinks=False)
                        is_dir = item.is_dir(follow_symlinks=False)
                        size = 0 if is_dir else stat.st_size
                        data: dict[str, Any] = {
                            "name": item.name,
                            "type": "dir" if is_dir else "file",
                            "size": size,
                            "mtime": round(stat.st_mtime * 1000),
                        }

                        if is_symlink:
                            try:
                                target = Path(os.path.realpath(item.path))
                                target.relative_to(base)
                                tstat = os.stat(target)
                                is_dir = os.path.isdir(target)
                                data.update(
                                    type="dir" if is_dir else "file",
                                    size=0 if is_dir else tstat.st_size,
                                    symlink=self.display_path(target),
                                )
                            except (OSError, ValueError):
                                continue

                        entries.append(data)
                    except OSError:
                        pass
            return sorted(entries, key=lambda x: (x["type"] != "dir", x["name"].lower()))

        return await self._run(scan)

    async def read_json(self, request: web.Request) -> dict[str, Any]:
        try:
            return await request.json()
        except Exception as err:
            raise web.HTTPBadRequest(text="Invalid JSON body") from err

    def _get_token_from_request(self, request: web.Request) -> str | None:
        """Extract bearer token from Authorization header or query string."""
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            return auth_header[7:].strip()
        # For WebSocket, token may be in query param
        return request.query.get("token") or request.query.get("authorization")

    def _admin_user(self, request: web.Request) -> bool:
        """Return True if request is authenticated as an active admin user."""
        token = self._get_token_from_request(request)
        if not token:
            return False
        try:
            refresh_token = self.hass.auth.async_validate_access_token(token)
            if refresh_token and refresh_token.user and refresh_token.user.is_active:
                return refresh_token.user.is_admin   # <-- admin check
        except Exception:
            pass
        return False

class FileShellApiView(HomeAssistantView, FileShellBase):
    url = "/api/file_shell"
    name = "api:file_shell"
    requires_auth = True

    async def _dispatch(self, request: web.Request, routes: dict[str, Callable[..., Any]]) -> web.Response:
        if not self._admin_user(request):
            return json_error("Admin privileges required", 403)
        action = request.query.get("action")
        handler = routes.get(action or "")
        return await handler(request) if handler else json_error(f"Unknown {request.method} action: {action}", 400)

    async def post(self, request: web.Request) -> web.Response:
        return await self._dispatch(
            request,
            {
                "list": self._list,
                "read": self._read,
                "stat": self._stat,
                "save": self._save,
                "mkdir": self._mkdir,
                "rename": self._rename,
                "delete": self._delete,
                "zip": self._zip,
                "extract": self._unzip,
                "chmod": self._chmod,
                "symlink": self._symlink,
                "valid": self._valid,
                "copy": lambda req: self._move(req, is_copy=True),
                "move": lambda req: self._move(req, is_copy=False),
            },
        )

    async def _list(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        path = self.safe_path(data.get("path"))
        if not path.exists():
            return json_error("Path does not exist", 404)
        if not path.is_dir():
            return json_error("Path is not a directory", 400)

        try:
            entries = await self.list_directory(path)
        except PermissionError:
            return json_error("Permission denied", 403)
        except OSError as err:
            return json_error(str(err), 500)
        return json_ok(base=str(self.base_dir), path=self.display_path(path), entries=entries)

    async def _read(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        path = self.safe_path(data.get("path"))
        TEXT_SIZE_LIMIT = 10 * 1024 * 1024
        if not path.exists() or not path.is_file():
            return json_error("File does not exist", 404)
        if (size := path.stat().st_size) > TEXT_SIZE_LIMIT:
            return json_error("Text file is too large to edit in browser", 413)

        content, err = await self._run_json(
            path.read_text,
            encoding="utf-8",
            extra_errors=((UnicodeDecodeError, "File is not valid text", 400),),
        )
        if err:
            return err
        return json_ok(path=self.display_path(path), content=content, size=size)

    async def _stat(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        unresolved, resolved = self._get_unresolved_resolved(data.get("path"))
        if not unresolved.exists() and not resolved.exists():
            return json_error("Path does not exist", 404)

        def get_info() -> dict[str, Any]:
            is_symlink = unresolved.is_symlink()
            target_st = resolved.stat()
            self_st = unresolved.lstat() if is_symlink else unresolved.stat()
            owner = self_st.st_uid
            group = self_st.st_gid

            
            try:
                import pwd, grp
                owner = pwd.getpwuid(owner).pw_name
                group = grp.getgrgid(group).gr_name
            except:
                pass
            return {
                "name": unresolved.name,
                "path": self.display_path(unresolved),
                "size": target_st.st_size,
                "mode": self_st.st_mode,
                "owner": owner,
                "group": group,
                "symlink": str(unresolved.readlink()) if is_symlink else None,
            }

        info, err = await self._run_json(get_info)
        return err or json_ok(info=info)
        
    async def _chmod(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        unresolved, _ = self._get_unresolved_resolved(data.get("path"))
        if not unresolved.exists():
            return json_error("Path does not exist", 404)

        def apply():
            if data.get("mode") is not None:
                os.chmod(str(unresolved), int(data["mode"], 8))

            st = unresolved.lstat() if unresolved.is_symlink() else unresolved.stat()
            if "owner" in data:
                owner = str(data["owner"]).strip()
                group = str(data["group"]).strip()
                try:
                    import pwd, grp
                    uid = int(owner) if owner.isdigit() else pwd.getpwnam(owner).pw_uid
                    gid = int(group) if group.isdigit() else grp.getgrnam(group).gr_gid
                except Exception as e:
                    raise ValueError(f"Failed to resolve owner/group: {e}")

                os.chown(str(unresolved), uid, gid)

        try:
            _, err = await self._run_json(apply, permission_msg="Permission denied (may need root for chown)")
        except ValueError as e:
            return json_error(str(e), 400)
        return err or json_ok(path=self.display_path(unresolved))

    async def _symlink(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        unresolved, _ = self._get_unresolved_resolved(data.get("path"))
        new_target = data.get("target")
        if not new_target or not isinstance(new_target, str):
            return json_error("Missing or invalid target", 400)

        target = Path(new_target)
        target = (unresolved.parent / target).resolve() if not target.is_absolute() else target.resolve()
        if err := self._path_in_base(target, "Target path is outside base directory"):
            return err

        def write_symlink() -> None:
            unresolved.parent.mkdir(parents=True, exist_ok=True)
            if unresolved.exists():
                unresolved.unlink()
            unresolved.symlink_to(target)

        if unresolved.exists() and not unresolved.is_symlink():
            return json_error("Path exists and is not a symbolic link", 400)

        _, err = await self._run_json(write_symlink)
        return err or json_ok(path=self.display_path(unresolved), target=str(target))

    async def _mkdir(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        parent = self.safe_path(data.get("path"))
        name = self._valid_name(data.get("name"), "Missing folder name", "Folder name must not contain path separators")
        if isinstance(name, web.Response):
            return name
        if not parent.exists() or not parent.is_dir():
            return json_error("Parent directory does not exist", 404)

        target = (parent / name).resolve()
        if err := self._path_in_base(target, "Invalid folder path"):
            return err
        _, err = await self._run_json(
            target.mkdir,
            parents=False,
            exist_ok=False,
            extra_errors=((FileExistsError, "Folder already exists", 409),),
        )
        return err or json_ok(path=self.display_path(target))

    async def _rename(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        unresolved, _ = self._get_unresolved_resolved(data.get("path"))
        new_name = self._valid_name(data.get("new_name"), "Missing new name", "New name must not contain path separators")
        if isinstance(new_name, web.Response):
            return new_name
        if not unresolved.exists():
            return json_error("Source path does not exist", 404)

        target = (unresolved.parent / new_name).resolve()
        if err := self._path_in_base(target, "Invalid target path"):
            return err
        if target.exists():
            return json_error("Target already exists", 409)

        _, err = await self._run_json(unresolved.rename, target)
        return err or json_ok(old_path=self.display_path(unresolved), new_path=self.display_path(target))

    async def _move(self, request: web.Request, is_copy: bool = True) -> web.Response:
        data = await self.read_json(request)
        raw_paths = self._non_empty_paths(data)
        if isinstance(raw_paths, web.Response):
            return raw_paths

        _, dest = self._get_unresolved_resolved(data.get("destination"))
        if not dest.exists() or not dest.is_dir():
            return json_error("Destination directory does not exist", 404)

        results: list[dict[str, str]] = []
        errors: list[dict[str, str]] = []

        for raw_src in raw_paths:
            unresolved_src, _ = self._get_unresolved_resolved(raw_src)
            target = dest / unresolved_src.name
            if message := self._copy_move_error(raw_src, unresolved_src, target, is_copy):
                errors.append(message)
                continue

            def transfer() -> None:
                if not is_copy:
                    shutil.move(str(unresolved_src), str(target))
                elif unresolved_src.is_symlink():
                    target.symlink_to(unresolved_src.readlink())
                elif unresolved_src.is_dir():
                    shutil.copytree(str(unresolved_src), str(target), symlinks=True)
                else:
                    shutil.copy2(str(unresolved_src), str(target), follow_symlinks=False)

            try:
                await self._run(transfer)
                results.append({"old_path": self.display_path(unresolved_src), "new_path": self.display_path(target)})
            except PermissionError:
                errors.append({"path": raw_src, "error": "Permission denied"})
            except (shutil.Error, OSError) as err:
                errors.append({"path": raw_src, "error": str(err)})

        if not results and errors:
            return json_error(errors[0]["error"], 400)
        return json_ok(results=results, errors=errors or None, destination=self.display_path(dest), is_copy=is_copy)

    def _copy_move_error(self, raw: Any, src: Path, target: Path, is_copy: bool) -> dict[str, str] | None:
        if src == self.base_dir:
            return {"path": raw, "error": "Refusing to copy/move filesystem root"}
        if not src.exists():
            return {"path": raw, "error": "Source path does not exist"}
        if target.exists():
            return {"path": raw, "error": "A file or folder with that name already exists in the destination"}
        if not is_copy and src.is_dir():
            try:
                target.relative_to(src)
                return {"path": raw, "error": "Cannot move a directory into itself or one of its subdirectories"}
            except ValueError:
                pass
        return None

    async def _delete(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        raw_paths = self._non_empty_paths(data)
        if isinstance(raw_paths, web.Response):
            return raw_paths

        deleted: list[str] = []
        errors: list[dict[str, str]] = []
        for raw in raw_paths:
            unresolved, resolved = self._get_unresolved_resolved(raw)
            if resolved == self.base_dir:
                errors.append({"path": raw, "error": "Refusing to delete filesystem root"})
                continue
            if not unresolved.exists():
                errors.append({"path": raw, "error": "Path does not exist"})
                continue

            def delete_one() -> None:
                if unresolved.is_symlink() or not unresolved.is_dir():
                    unresolved.unlink()
                else:
                    shutil.rmtree(unresolved)

            try:
                await self._run(delete_one)
                deleted.append(self.display_path(unresolved))
            except PermissionError:
                errors.append({"path": raw, "error": "Permission denied"})
            except OSError as err:
                errors.append({"path": raw, "error": str(err)})

        if not deleted and errors:
            return json_error(errors[0]["error"], 400)
        return json_ok(deleted=deleted, errors=errors or None)


    async def _save(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        path = self.safe_path(data.get("path"))
        content = data.get("content")
        if not isinstance(content, str):
            return json_error("Missing content", 400)
        if not data.get("existing") and path.exists():
            return json_error("File already exists", 409)

        def save_file() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            st = path.stat() if path.exists() else None
            with AtomicWriter(path, overwrite=True).open() as f:
                f.write(content)
            if st is not None:
                try:
                    with path.open("a") as fdesc:
                        os.fchmod(fdesc.fileno(), st.st_mode)
                        os.fchown(fdesc.fileno(), st.st_uid, st.st_gid)
                except Exception:
                    pass

        try:
            await self._run(save_file)
        except PermissionError:
            return json_error("Permission denied", 403)
        except OSError as err:
            return json_error(str(err), 500)
        except Exception:
            return json_error("Saving failed", 400)
        return json_ok(path=self.display_path(path))

    async def _zip(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        raw_paths = self._non_empty_paths(data)
        if isinstance(raw_paths, web.Response):
            return raw_paths

        items: list[tuple[Path, Path]] = []
        for raw in raw_paths:
            unresolved, resolved = self._get_unresolved_resolved(raw)
            if not resolved.exists():
                return json_error(f"Path does not exist: {raw}", 404)
            items.append((unresolved, resolved))

        output_zip = (items[0][0].parent / self._zip_name(items)).resolve()
        if err := self._path_in_base(output_zip, "Invalid zip target path"):
            return err

        def create_zip() -> Path:
            zip_path = self._unique_path(output_zip)
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for unresolved, resolved in items:
                    self._add_to_zip(archive, resolved, unresolved.name)
            return zip_path

        zip_path, err = await self._run_json(
            create_zip,
            extra_errors=((FileExistsError, None, 409), (zipfile.BadZipFile, None, 500)),
        )
        return err or json_ok(path=self.display_path(zip_path), name=zip_path.name)

    def _zip_name(self, items: list[tuple[Path, Path]]) -> str:
        if len(items) == 1:
            single = items[0][0]
            return f"{single.name if single.is_dir() else single.stem}.zip"
        parents = [item[0].parent for item in items]
        return f"{parents[0].name}.zip" if all(p == parents[0] for p in parents) and parents[0].name else "selected.zip"

    def _unique_path(self, path: Path) -> Path:
        if not path.exists():
            return path
        for i in range(1, 10000):
            candidate = path.with_name(f"{path.stem} ({i}){path.suffix}")
            if not candidate.exists():
                return candidate
        raise FileExistsError("Could not find an available zip filename")

    def _add_to_zip(self, archive: zipfile.ZipFile, src: Path, arc_name: str) -> None:
        if not src.is_dir():
            archive.write(src, arc_name)
            return
        for root, dirs, files in os.walk(src):
            dirs[:] = [d for d in dirs if not (Path(root) / d).is_symlink()]
            rel_root = Path(arc_name) / Path(root).relative_to(src)
            if not dirs and not files:
                archive.writestr(str(rel_root) + "/", "")
            for name in files:
                fp = Path(root) / name
                if not fp.is_symlink():
                    archive.write(fp, str(rel_root / name))

    async def _unzip(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        unresolved, resolved = self._get_unresolved_resolved(data.get("path"))
        if not resolved.exists() or not resolved.is_file():
            return json_error("File does not exist", 404)

        target_dir = unresolved.parent.resolve()
        if err := self._path_in_base(target_dir, "Extraction directory is outside base directory"):
            return err

        suffix = resolved.suffix.lower()
        is_tar_gz = resolved.suffixes[-2:] == [".tar", ".gz"]
        is_tgz = suffix == ".tgz"
        if not (is_tar_gz or is_tgz or suffix in {".zip", ".gz", ".tar"}):
            return json_error("Unsupported archive format", 400)

        def extract() -> int:
            if suffix == ".zip":
                return self._extract_zip(resolved, target_dir)
            if suffix == ".tar":
                return self._extract_tar(resolved, target_dir, "r")
            if is_tar_gz or is_tgz or (suffix == ".gz" and resolved.stem.endswith(".tar")):
                return self._extract_tar(resolved, target_dir, "r:gz")
            if suffix == ".gz":
                return self._extract_gzip(resolved, target_dir)
            raise ValueError("Unsupported archive")

        extracted, err = await self._run_json(
            extract,
            extra_errors=(
                (zipfile.BadZipFile, "Invalid zip archive", 400),
                (gzip.BadGzipFile, "Invalid gzip archive", 400),
                (tarfile.TarError, "Invalid tar archive", 400),
                (ValueError, None, 400),
            ),
        )
        return err or json_ok(path=self.display_path(target_dir), extracted=extracted)

    def _safe_archive_name(self, name: str) -> bool:
        path = Path(name)
        return ".." not in path.parts and not path.is_absolute()

    def _assert_archive_target(self, base: Path, name: str) -> None:
        if not self._safe_archive_name(name):
            raise ValueError("Unsafe archive entry")
        (base / name).resolve().relative_to(base)

    def _extract_zip(self, archive_path: Path, target_dir: Path) -> int:
        with zipfile.ZipFile(archive_path, "r") as archive:
            for member in archive.infolist():
                self._assert_archive_target(target_dir, member.filename)
            archive.extractall(target_dir)
            return len(archive.infolist())

    def _extract_tar(self, archive_path: Path, target_dir: Path, mode: str) -> int:
        with tarfile.open(archive_path, mode) as archive:
            members = archive.getmembers()
            for member in members:
                self._assert_archive_target(target_dir, member.name)
            archive.extractall(target_dir, filter="data")
            return len(members)

    def _extract_gzip(self, archive_path: Path, target_dir: Path) -> int:
        with gzip.open(archive_path, "rb") as src, (target_dir / archive_path.stem.replace(".tar", "")).open("wb") as dst:
            shutil.copyfileobj(src, dst)
        return 1

    async def _valid(self, request: web.Request) -> web.Response:
        data = await self.read_json(request)
        content = data.get("content", "")
        fileext = str(data.get("ext", ""))

        def validate():
            if fileext in ("yaml", "yml"):
                class MyYAML(SafeLoader): pass
                def anytag(loader, tag, node):
                    if isinstance(node, yaml.ScalarNode):
                        return f"<{tag}>"
                    elif isinstance(node, yaml.SequenceNode):
                        return loader.construct_sequence(node)
                    elif isinstance(node, yaml.MappingNode):
                        return loader.construct_mapping(node)
                    return f"<{tag}>"

                add_multi_constructor('!', anytag, Loader=MyYAML)

                try:
                    yaml.load(content, Loader=MyYAML)
                    return None
                except yaml.YAMLError as e:
                    r = {"error": str(e)}
                    if hasattr(e, "problem_mark"):
                        r["line"] = e.problem_mark.line + 1
                        r["column"] = e.problem_mark.column + 1
                    return r

            elif fileext == "py":
                try:
                    ast.parse(content)
                    return None
                except SyntaxError as e:
                    return {"error": str(e), "line": e.lineno, "column": e.offset}

        result = await self.hass.async_add_executor_job(validate)
        if result is None:
            return json_ok(valid=True)
        return json_ok(valid=False, **result)

class FileShellStreamView(HomeAssistantView, FileShellBase):
    url = "/api/file_shell_stream"
    name = "api:file_shell_stream"
    requires_auth = False

    async def get(self, request: web.Request) -> web.StreamResponse:
        if not self._admin_user(request):
            return json_error("Unauthorized", 401)

        path = self.safe_path(request.query.get("path"))
        if not path.exists() or not path.is_file():
            return json_error("File Not Found", 404)

        action = request.query.get("action")
        headers = {"Content-Disposition": f'attachment; filename="{path.name}"'}
        if not action == "download":
            headers = {}

        return web.FileResponse(path, headers=headers)

    async def post(self, request: web.Request) -> web.Response:
        if (action := request.query.get("action")) != "upload":
            return json_error(f"Unknown POST stream action: {action}", 400)
        if not self._admin_user(request):
            return json_error("Unauthorized", 401)
        return await self._upload(request)

    async def _upload(self, request: web.Request) -> web.Response:
        target_dir = self.safe_path(request.query.get("path"))
        if not target_dir.exists():
            return json_error("Upload directory does not exist", 404)
        if not target_dir.is_dir():
            return json_error("Upload target is not a directory", 400)

        relpath = request.query.get("relpath")
        mtime_ms = request.query.get("mtime")

        try:
            reader = await request.multipart()
        except Exception:
            return json_error("Expected multipart upload", 400)

        uploaded: list[str] = []
        async for part in reader:
            if part.name != "file":
                continue
                
            if relpath:
                dest = (target_dir / relpath).resolve()
                filename = dest.name
                res = relpath
            else:
                filename = Path(part.filename or "").name
                if not filename:
                    continue
                dest = (target_dir / filename).resolve()
                res = filename

            if err := self._path_in_base(dest, "Invalid upload path"):
                return err
            dest.parent.mkdir(parents=True, exist_ok=True)
            
            try:
                file_obj = await self._run(dest.open, "wb")
            except PermissionError:
                return json_error("Permission denied", 403)
            except OSError as err:
                return json_error(str(err), 500)

            total = 0
            CHUNK_SIZE = 1024 * 1024
            try:
                while chunk := await part.read_chunk(CHUNK_SIZE):
                    total += len(chunk)
                    await self._run(file_obj.write, chunk)
            finally:
                await self._run(file_obj.close)

            if mtime_ms is not None:
                try:
                    mtime_sec = int(mtime_ms) / 1000.0
                    await self._run(os.utime, str(dest), (mtime_sec, mtime_sec))
                except Exception:
                    pass

            uploaded.append(res)
        msg = f"Uploaded: {', '.join(uploaded)}" if uploaded else "No files uploaded"
        return json_ok(msg=msg)

class FileShellTerminalView(HomeAssistantView, FileShellBase):
    url = "/api/file_shell_terminal"
    name = "api:file_shell_terminal"
    requires_auth = False

    async def get(self, request: web.Request) -> web.WebSocketResponse:
        if not self._admin_user(request):
            raise web.HTTPUnauthorized(text="Admin privileges required")

        if not PTY:
            raise web.HTTPInternalServerError(text="PTY not supported on this system")

        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)

        master_fd = -1
        slave_fd = -1
        proc = None
        sender_task = None
        output_queue: asyncio.Queue[bytes | None] = asyncio.Queue()

        def set_winsize(cols: int, rows: int) -> None:
            cols = max(10, min(int(cols), 300))
            rows = max(5, min(int(rows), 100))
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

        def on_pty_readable() -> None:
            try:
                while True:
                    try:
                        data = os.read(master_fd, 4096)
                    except BlockingIOError:
                        break

                    if not data:
                        output_queue.put_nowait(None)
                        break

                    output_queue.put_nowait(data)
            except OSError:
                output_queue.put_nowait(None)

        async def send_output() -> None:
            while True:
                data = await output_queue.get()
                if data is None or ws.closed:
                    break
                await ws.send_bytes(data)

        try:
            master_fd, slave_fd = pty.openpty()
            set_winsize(80, 24)

            flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
            fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

            shell = shutil.which("bash") or shutil.which("sh") or "/bin/sh"

            env = os.environ.copy()
            env["TERM"] = "xterm-256color"

            proc = subprocess.Popen(
                [shell],
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=os.environ.get("HOME", "/"),
                start_new_session=True,
                close_fds=True,
                env=env,
            )

            os.close(slave_fd)
            slave_fd = -1

            loop = asyncio.get_running_loop()
            loop.add_reader(master_fd, on_pty_readable)

            sender_task = asyncio.create_task(send_output())

            async for msg in ws:
                if msg.type == web.WSMsgType.BINARY:
                    try:
                        os.write(master_fd, msg.data)
                    except OSError:
                        break

                elif msg.type == web.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        resize = data.get("resize")

                        if isinstance(resize, list) and len(resize) == 2:
                            set_winsize(resize[0], resize[1])
                    except Exception:
                        pass

                elif msg.type in (
                    web.WSMsgType.ERROR,
                    web.WSMsgType.CLOSE,
                    web.WSMsgType.CLOSING,
                    web.WSMsgType.CLOSED,
                ):
                    break

        except Exception:
            _LOGGER.exception("Terminal handler crashed")

        finally:
            if master_fd >= 0:
                with contextlib.suppress(Exception):
                    asyncio.get_running_loop().remove_reader(master_fd)

            with contextlib.suppress(Exception):
                output_queue.put_nowait(None)

            if sender_task:
                sender_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await sender_task

            if proc and proc.poll() is None:
                with contextlib.suppress(Exception):
                    proc.terminate()

                try:
                    await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=2)
                except Exception:
                    with contextlib.suppress(Exception):
                        proc.kill()
                    with contextlib.suppress(Exception):
                        await asyncio.to_thread(proc.wait)

            if slave_fd >= 0:
                with contextlib.suppress(Exception):
                    os.close(slave_fd)

            if master_fd >= 0:
                with contextlib.suppress(Exception):
                    os.close(master_fd)

            if not ws.closed:
                with contextlib.suppress(Exception):
                    await ws.close()

        return ws