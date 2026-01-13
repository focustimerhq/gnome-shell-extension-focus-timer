gnome = import('gnome')

install_data(
  'org.gnome.shell.extensions.focus-timer.gschema.xml',
  install_dir: schemas_dir
)

if glib_compile_schemas.found()
  test('Validate schema file', glib_compile_schemas,
    args: ['--strict', '--dry-run', meson.current_source_dir()]
  )
endif

if not get_option('bundle')
  gnome.post_install(
    glib_compile_schemas: true,
  )
endif
