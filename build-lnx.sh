#!/bin/bash

cd prj
pnpm desktop:package:linux
cp -v ./desktop/release/*.AppImage /S/Library/Software/Applications/Tronog/TR-File/
