# Changing Stack-chan Settings Using a Web Browser

[日本語](./setting-preferences-web_ja.md)

You can modify Stack-chan's settings from a web browser.
Since it connects using BLE (Bluetooth Low Energy), you don't need to set up Wi-Fi in advance.

The redesign branch uses settings protocol 2. Use Web tools from the same revision as the firmware. During development, run `npm run dev` from the repository's `web` directory and open its settings page.

## Prerequisites

* Your PC or smartphone supports Web Bluetooth API

## Steps

* Start Stack-chan while pressing the C button. For models with a touch panel (Core2, CoreS3), start Stack-chan while touching the panel.
* The settings screen will be displayed on the M5Stack.

![Settings Screen (M5Stack)](./images/web-preference-launch.jpg)

* Open https://stack-chan.github.io/stack-chan/web/preference/

![Settings Screen (Web Browser)](./images/web-preference-top.png)

* Choose the BLE connect button (the screenshots show the older UI).

![Connection Screen](./images/web-preference-connect.png)

* Select "STK"

![Settings Form](./images/web-preference-form.png)

* Edit the settings you want to change and select the save button.
* Wait for confirmation that the device saved the settings. Follow the displayed instructions for changes that require a restart or a new Wi-Fi connection.

Passwords and tokens display their configured status without exposing their values. Leave untouched secrets blank. To remove one, select its clear action and save. Clearing Wi-Fi saves an empty SSID and password together, so the next boot is offline.

A disconnected or unanswered save is not reported as successful. Sends to older firmware are marked unconfirmed. Reconnect and review the device settings. A hardware-fixed driver cannot be changed, and a batch containing invalid values is rejected before writing any field.

Settings resolve in this order: shared defaults, device profile, MOD defaults, saved values. Wi-Fi is host owned and ignores MOD defaults. See the [settings service design](../../docs/architecture/settings-service.md) for the detailed contract.

The firmware saves a batch with a persistent recovery record. If a save is interrupted, the next boot restores the previous complete batch unless the new batch had already committed. A failed recovery blocks settings reads and writes instead of starting with mixed values. Reconnect after restart and review the saved configuration. Actual power-loss behavior on hardware still needs acceptance testing.
