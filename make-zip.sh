#!/bin/sh

set -e

# Based on script by Florian Müllner gnome-shell-extensions/export-zips.sh
# and gamemode-extension/make-zip.sh by Christian Kellner

# Check script dependencies
for cmd in meson ninja gnome-extensions zip; do
    if ! [ -x "$(command -v ${cmd})" ]; then
        echo "Need '${cmd}' command. Please install." >&2
        exit 1
    fi
done

srcdir=`dirname $0`
srcdir=`(cd $srcdir && pwd)`
builddir="${srcdir}/.build-zip"
installdir="${srcdir}/.install-zip"
uuid="focus-timer@focustimerhq.github.io"
zipname="$uuid.zip"

# Build the extension and install it into a temporary directory.
# Then, pack the extension into a zip file.
build () {
    meson setup --prefix=$installdir -Dbundle=true $srcdir $builddir
    ninja -C$builddir install

    extensiondir="${installdir}/share/gnome-shell/extensions/${uuid}"
    (cd $extensiondir && zip -qr "${srcdir}/${zipname}" .)

    echo "Extension saved to ${zipname}"
}

install () {
    gnome-extensions --force install "${srcdir}/${zipname}" || exit 1
    echo "Installed ${uuid}"
}

cleanup () {
    rm -rf $builddir
    rm -rf $installdir
}

usage () {
    echo "usage: $0 [install]"
    exit 1
}

if [ "$#" -ge 1 ]; then
    case "$1" in
    install)
        cleanup
        build
        cleanup
        install
        ;;
    *)
        usage
        ;;
    esac
else
    cleanup
    build
fi
