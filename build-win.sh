#!/bin/bash

cd prj
pnpm desktop:package:win
cp -v ./desktop/release/tr-file-Setup-0.1.0-x64.exe /S/Library/Software/Applications/Tronog/TR-File/
