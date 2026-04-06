#!/bin/sh
# SPDX-License-Identifier: MIT OR LGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 Focus Timer contributors

srcdir=$(dirname -- "$0")

cd $srcdir
[ ! -d node_modules ] && npm clean-install
# Link in project root to make imports work properly
[ ! -e ../node_modules ] && ln -s $srcdir/node_modules ../node_modules
npm run lint -- "$@"

