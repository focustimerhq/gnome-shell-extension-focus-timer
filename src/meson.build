install_data(
  [
    'dbus.js',
    'distractions.js',
    'extension.js',
    'indicator.js',
    'notifications.js',
    'prefs.js',
    'screenOverlay.js',
    'screenShield.js',
    'session.js',
    'settings.js',
    'stylesheet.css',
    'timer.js',
    'timerControlButtons.js',
    'timerLabel.js',
    'timerProgressBar.js',
    'utils.js',
  ],
  install_dir: extension_dir,
)

configure_file(
  input: 'metadata.json.in',
  output: 'metadata.json',
  configuration: conf,
  install_dir: extension_dir,
)

configure_file(
  input: 'config.js.in',
  output: 'config.js',
  configuration: conf,
  install_dir: extension_dir,
)

install_subdir(
  'icons',
  install_dir: extension_dir,
)
