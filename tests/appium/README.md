# Appium (Slice 12)

- **Appium server:** 2.19.0 (do not use Appium 3).
- **XCUITest driver:** `xcuitest@9.10.5` (`appium driver install xcuitest@9.10.5`).
- **iOS bundle id:** `com.sideline.app` (`mobile/app.json`).

```bash
pip install -r tests/appium/requirements.txt
pytest tests/appium/test_mobile_deeplink.py -v
```

Tests skip when Appium is not listening on `http://localhost:4723` or when no Android device is attached for the adb deeplink case.
