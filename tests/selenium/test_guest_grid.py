"""Guest live page checks via Selenium Grid (Slice 12). Hub: http://localhost:4444"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

import pytest
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

HUB_URL = "http://localhost:4444"
# Browser runs inside Grid nodes; host loopback is not reachable from there.
API_BASE = "http://host.docker.internal:8080"
HOST_API = "http://127.0.0.1:8080"
LIVE_PATH = "/web/matches/match-m1/live"


def _grid_ready() -> bool:
    try:
        with urllib.request.urlopen(f"{HUB_URL}/status", timeout=5) as resp:
            body = json.load(resp)
        value = body.get("value", body)
        return value.get("ready") is True
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError):
        return False


def _reset_baseline() -> None:
    req = urllib.request.Request(
        f"{HOST_API}/audit/v1/reset",
        data=b"{}",
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 200:
            raise RuntimeError(f"reset failed: HTTP {resp.status}")


@pytest.fixture(scope="module")
def require_grid():
    if not _grid_ready():
        pytest.skip(f"Selenium Grid not ready at {HUB_URL}/status")
    try:
        _reset_baseline()
    except OSError as err:
        pytest.skip(f"API not reachable at {HOST_API} for reset: {err}")


@pytest.fixture
def driver(require_grid):
    options = webdriver.ChromeOptions()
    browser = webdriver.Remote(command_executor=HUB_URL, options=options)
    browser.set_page_load_timeout(30)
    yield browser
    browser.quit()


def _open_live(driver: webdriver.Remote) -> None:
    driver.get(f"{API_BASE}/q/m1-live")
    WebDriverWait(driver, 15).until(lambda d: LIVE_PATH in d.current_url)


def _modal_hidden(driver: webdriver.Remote) -> bool:
    modal = driver.find_element(By.ID, "progressive-auth-modal")
    if modal.get_attribute("hidden") is not None:
        return True
    style = modal.value_of_css_property("display")
    return style == "none"


def test_redirect_to_live_with_score_and_no_modal(driver):
    _open_live(driver)
    assert LIVE_PATH in driver.current_url

    banner = WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.ID, "live-score-banner")))
    assert "1 - 0" in banner.text

    assert driver.find_element(By.ID, "guest-video-player") is not None
    assert _modal_hidden(driver)


def test_chat_send_shows_modal_without_appending(driver):
    _open_live(driver)
    chat_input = driver.find_element(By.ID, "chat-input-field")
    chat_list = driver.find_element(By.ID, "chat-message-list")
    before_count = len(chat_list.find_elements(By.TAG_NAME, "li"))

    chat_input.send_keys("Hello from grid")
    driver.find_element(By.ID, "chat-send-btn").click()

    WebDriverWait(driver, 5).until(lambda d: not _modal_hidden(d))
    after_count = len(chat_list.find_elements(By.TAG_NAME, "li"))
    assert after_count == before_count
    assert "Hello from grid" not in chat_list.text


def test_add_to_cart_sets_count_to_one(driver):
    driver.get(f"{API_BASE}{LIVE_PATH}")
    WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.ID, "guest-cart-count")))

    count = driver.find_element(By.ID, "guest-cart-count")
    assert count.text.strip() == "0"

    driver.find_element(By.ID, "add-to-guest-cart-btn").click()

    WebDriverWait(driver, 5).until(lambda d: d.find_element(By.ID, "guest-cart-count").text.strip() == "1")
