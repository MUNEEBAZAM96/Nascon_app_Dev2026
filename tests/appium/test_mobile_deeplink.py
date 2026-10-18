"""Appium / adb deeplink probes (Slice 12). Requires Appium 2.19.x, not Appium 3."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request

import pytest

APPIUM_URL = os.environ.get("APPIUM_URL", "http://127.0.0.1:4723")
IOS_BUNDLE_ID = "com.sideline.app"
DEEPLINK = "nascon://entity/match-m1"


def _appium_ready() -> bool:
    try:
        with urllib.request.urlopen(f"{APPIUM_URL}/status", timeout=5) as resp:
            body = json.load(resp)
        value = body.get("value", body)
        return value.get("ready") is True
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError):
        return False


def test_appium_server_ready():
    if not _appium_ready():
        pytest.skip(f"Appium not ready at {APPIUM_URL}/status (use Appium 2.19.0, not Appium 3)")


def test_android_adb_deeplink_when_device_attached():
    adb = shutil.which("adb")
    if adb is None:
        pytest.skip("adb not on PATH")

    devices = subprocess.run([adb, "devices"], capture_output=True, text=True, check=False)
    lines = [line for line in devices.stdout.splitlines()[1:] if line.strip() and "device" in line.split()]
    if not lines:
        pytest.skip("no Android device/emulator attached")

    result = subprocess.run(
        [
            adb,
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            DEEPLINK,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout


@pytest.mark.skipif(
    not os.environ.get("IOS_UDID"),
    reason="Set IOS_UDID to run XCUITest smoke against com.sideline.app",
)
def test_ios_bundle_id_session_smoke():
    if not _appium_ready():
        pytest.skip(f"Appium not ready at {APPIUM_URL}/status")

    from appium import webdriver
    from appium.options.common import AppiumOptions

    options = AppiumOptions()
    options.set_capability("platformName", "iOS")
    options.set_capability("appium:automationName", "XCUITest")
    options.set_capability("appium:bundleId", IOS_BUNDLE_ID)
    options.set_capability("appium:udid", os.environ["IOS_UDID"])

    driver = webdriver.Remote(f"{APPIUM_URL}", options=options)
    try:
        assert driver.session_id
    finally:
        driver.quit()
