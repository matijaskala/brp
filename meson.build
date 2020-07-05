project('brzip', 'c', 'vala')

add_project_arguments('--vapidir', meson.current_source_dir(), language: 'vala')

glib_dep = dependency('glib-2.0')
gobject_dep = dependency('gobject-2.0')

libbrotlienc = dependency('libbrotlienc')
libbrotlidec = dependency('libbrotlidec')
brotli_dep = declare_dependency(dependencies: [libbrotlienc, libbrotlidec])

xxhash_lib = meson.get_compiler('c').find_library('xxhash')
xxhash_vapi = meson.get_compiler('vala').find_library('xxhash', dirs: meson.current_source_dir())
xxhash_dep = declare_dependency(dependencies: [xxhash_lib, xxhash_vapi])

stat_vapi = meson.get_compiler('vala').find_library('stat', dirs: meson.current_source_dir())

posix_dep = meson.get_compiler('vala').find_library('posix')

if get_option('btrfs')
	btrfs_dep = meson.get_compiler('c').find_library('btrfs')
	brzip = executable('brzip', 'brzip.gs', dependencies: [glib_dep, gobject_dep, brotli_dep, xxhash_dep, stat_vapi, posix_dep, btrfs_dep], install: true)
else
	brzip = executable('brzip', 'brzip.gs', 'crc32c.c', dependencies: [glib_dep, gobject_dep, brotli_dep, xxhash_dep, stat_vapi, posix_dep], install: true)
endif

install_man('brzip.1')

meson.add_install_script('sh', '-c', 'NAME=$(basename @0@) ; ln -sf $NAME "$DESTDIR/@1@/@2@"/brcat${NAME#brzip}'.format(brzip.full_path(), get_option('prefix'), get_option('bindir')))
meson.add_install_script('sh', '-c', 'NAME=$(basename @0@) ; ln -sf $NAME "$DESTDIR/@1@/@2@"/brunzip${NAME#brzip}'.format(brzip.full_path(), get_option('prefix'), get_option('bindir')))
