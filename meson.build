project(
  'gnome-shell-extension-focus-timer',
  'c',
  version: '1',
  meson_version: '>=0.59.0',
)

gnome = import('gnome')
i18n = import('i18n')

glib_compile_schemas = find_program('glib-compile-schemas', required: false)

prefix = get_option('prefix')
datadir = join_paths(prefix, get_option('datadir'))
localedir = join_paths(prefix, get_option('localedir'))
schemas_dir = join_paths(datadir, 'glib-2.0', 'schemas')
gettext_domain = meson.project_name()

extension_uuid = 'focus-timer@focustimerhq.github.io'
extension_dir = join_paths(datadir, 'gnome-shell', 'extensions', extension_uuid)

if get_option('bundle')
  localedir = join_paths(extension_dir, 'locale')
  schemas_dir = join_paths(extension_dir, 'schemas')
endif

conf = configuration_data()
conf.set('PACKAGE_NAME', meson.project_name())
conf.set('PACKAGE_VERSION', meson.project_version())
conf.set('PACKAGE_URL', 'https://github.com/focustimerhq/gnome-shell-extension-focus-timer')
conf.set('PACKAGE_BUGREPORT', 'https://github.com/focustimerhq/gnome-shell-extension-focus-timer/issues')
conf.set('PACKAGE_FLATHUB_URL', 'https://flathub.org/en/apps/io.github.focustimerhq.FocusTimer')
conf.set('GETTEXT_PACKAGE', gettext_domain)
conf.set('EXTENSION_UUID', extension_uuid)
conf.set('APPLICATION_ID', 'io.github.focustimerhq.FocusTimer')

subdir('po')
subdir('data')
subdir('src')

custom_target('gnome-shell-extension-focus-timer-zip',
  depends: [],
  output: extension_uuid + '.zip',
  command: ['make-zip.sh'],
  build_by_default: false
)
