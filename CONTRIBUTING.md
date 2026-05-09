# Contributing to Focus Timer Extension

Thanks for considering contributing! Whether you're fixing bugs, translating, or adding features, your help is incredibly valuable.

## Reporting issues

If you found a bug, please check the [Troubleshooting](#troubleshooting) section first.

When opening an issue on [GitHub](https://github.com/focustimerhq/gnome-shell-extension-focus-timer/issues), please include:
- GNOME Shell version
- Extension version
- Focus Timer version
- [GNOME Shell logs](#getting-gnome-shell-logs) relevant to the issue
- Steps to reproduce the bug

Suggestions are welcomed too!

## Troubleshooting

### Can't see the indicator

Ensure that the Focus Timer app is running.

Then, please check the [Extensions app](https://flathub.org/en/apps/org.gnome.Extensions):
- Check if extensions are enabled globally
- Check if *Focus Timer* extension is enabled and there are no errors

If you updated the extension, the new version will only be fully loaded after you log out and log back in.

### Getting GNOME Shell logs

The extension uses the GNOME Shell log.

View logs since boot:
```bash
journalctl /usr/bin/gnome-shell -b
```

View logs in real time:
```bash
journalctl /usr/bin/gnome-shell -f
```

## Translating

We use Gettext for translations. The `.pot` template and language `.po` files are located in the [po/ directory](po). The app and the extension have separate translations.

If you'd like to add or update a language:
1. Generate/Update the `.po` file for your language using `msginit` or by editing an existing one in the [po/ directory](po).
2. Ensure your language is in [LINGUAS](po/LINGUAS) file
3. Submit your changes via a Pull Request.

LLM prompt to ease the process:
> Fill-in missing translations and update fuzzy translations for the given file. Translations are for an desktop Pomodoro timer app. Take care to use consistent same translations for words: "break", "pause", "start", "stop", "rewind", "interruption". "pause" refers to the timer action, while "break" refers to taking a break from work, "interruption" refers to a distraction. Translations does not need to be exact, but must convey same meaning - make them sound natural. Mark modified entries as fuzzy. Output the updated .po file for download, do not truncate it.

We keep `.po` files in sync with the `.pot` file. Generally, there's no need to sync it manually.

## Development

### Minimal setup

If you're touching code, to test changes it's best to run gnome-shell container:

```bash
dbus-run-session -- gnome-shell --devkit --wayland
```

This way you don't need to log out to test changes.

But, that's not all. Inside the container, run:
```
gnome-extensions enable focus-timer@focustimerhq.github.io
flatpak run io.github.focustimerhq.FocusTimer
```

The Focus Timer app inside the container is isolated from your user session to some extent — the data is shared. You'll need to run it each time.

### GNOME Builder setup

For making larger changes, we strongly suggest using [GNOME Builder](https://flathub.org/en/apps/org.gnome.Builder).

GNOME Builder will allow you to automate the installation and running process:

1. Create a *Command*

    Shell Command: `dbus-run-session -- gnome-shell --devkit --wayland`

    Add env: `SHELL_DEBUG=backtrace-warnings` to show traceback on warnings.

2. In *Application* settings

    Change *Run Command* to the newly created.

    Ensure *Install Before Running* is on.

3. In *Default* configuration

    Ensure that *Installation Prefix* is: `~/.local`

    Ensure that *Configure Options* is: `--prefix=~/.local`

    You may need to select the *Runtime* to: *gnome-shell-devel*

Instead of running the project like an app, you run `gnome-shell`.

### Running with latest GNOME Shell

Clone [gnome-shell repo](https://gitlab.gnome.org/GNOME/gnome-shell) and setup toolbox:

```bash
git clone https://gitlab.gnome.org/GNOME/gnome-shell.git contrib/gnome-shell
cd contrib/gnome-shell
./tools/toolbox/create-toolbox.sh
./tools/toolbox/run-gnome-shell.sh
```

### Style Guide

We follow the standard GNOME styling rules. Please ensure your code adheres to:
* [GNOME Shell Style Guide](https://wiki.gnome.org/Projects/GnomeShell/StyleGuide)
* [Gjs Style Guide](https://live.gnome.org/GnomeShell/Gjs_StyleGuide)

**Linting:**
The repository includes an ESLint configuration. You can check your code by running:

```
./run-es-lint.sh src/
```

If it's the first run, set it up:

```bash
cd tools
npm install
```

### D-Bus connection

The extension uses the D-Bus service of the main Focus Timer app, and the extension is running its own service. The communication goes both ways. Helpful commands for debugging the connection:

```bash
dbus-monitor --session --monitor "sender='io.github.focustimerhq.FocusTimer'"
dbus-monitor --session --monitor "sender='io.github.focustimerhq.FocusTimer.ShellIntegration'"
```

Documentation for the app services:
* [io.github.focustimerhq.FocusTimer](https://github.com/focustimerhq/FocusTimer/blob/main/data/io.github.focustimerhq.FocusTimer.xml)
* [io.github.focustimerhq.FocusTimer.Timer](https://github.com/focustimerhq/FocusTimer/blob/main/data/io.github.focustimerhq.FocusTimer.Timer.xml)
* [io.github.focustimerhq.FocusTimer.Session](https://github.com/focustimerhq/FocusTimer/blob/main/data/io.github.focustimerhq.FocusTimer.Session.xml)

### Useful Resources

* [Extensions Documentation](https://gjs.guide/extensions/)
* [GJS Documentation](https://gjs-docs.gnome.org/)
* [Guide on development of GNOME Shell](https://wiki.gnome.org/Projects/GnomeShell/Development)
* [Debugging GNOME Shell extensions](https://gjs.guide/extensions/development/debugging.html#debugging)
