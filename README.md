# GNOME Shell extension for Focus Timer
# Focus Timer GNOME Shell Extension

Focus Timer helps with taking breaks according to [Pomodoro Technique](https://en.wikipedia.org/wiki/Pomodoro_Technique). It intends to help maintain your focus and health. This GNOME Shell extension needs the [Focus Timer app][focus-timer] to be installed. It allows better desktop integration:

* Indicator in the top bar for controling the timer
* Notifications showing real time
* Semi-translucent screen overlay is easier to dismiss if needed
* Widget on the lock screen

## Screenshots

![Indicator](https://gnomepomodoro.org/release/1.1/gnome-shell-indicator.png)
![Screen overlay](https://gnomepomodoro.org/release/1.1/gnome-shell-screen-overlay.png)
![Lock screen widget](https://gnomepomodoro.org/release/1.1/gnome-shell-widget.png)
![Preferences](https://gnomepomodoro.org/release/1.1/gnome-shell-preferences.png)

## Installation

The extension is compatible with GNOME Shell 48+.

### From extensions.gnome.org

The extension at this moment is not published yet.

### Building from source

To build the application from source, you will need `meson`, `ninja`, and the necessary development headers (GLib, GTK+, etc.).

Clone the repository:

```bash
git clone https://github.com/focustimerhq/gnome-shell-extension-focus-timer.git
cd gnome-shell-extension-focus-timer
```

Build and install:
```bash
meson setup build --prefix=~/.local/
ninja -C build
ninja -C build install
```

### From .zip bundle

Only install files from a trusted source.

```
gnome-extensions install --force focus-timer@focustimerhq.github.io.zip
```

## Support

### Report issue

### Suggest improvements

### Q&A

Feel free to start a discussion if you have a question.

## Contributing

### Translations

### Leave a review

### Donations

If you want to sponsor me, first of all thank you very much! You can use either [Liberapay](https://liberapay.com/kamilprusko) or [PayPal](https://www.paypal.me/kamilprusko); and don't hesitate to ask for more specialized support if you need to!

## License

This software is licensed under the [GPL 3](/COPYING).

*This project is not affiliated with, authorized by, sponsored by, or otherwise approved by GNOME Foundation and/or the Pomodoro Technique®. The GNOME logo and GNOME name are registered trademarks or trademarks of GNOME Foundation in the United States or other countries. The Pomodoro Technique® and Pomodoro™ are registered trademarks of Francesco Cirillo.*

[focus-timer]: https://github.com/focustimerhq/FocusTimer/tree/main
