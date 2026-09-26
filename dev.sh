#!/bin/bash

if [ -e "prj" ]
then
  cd prj
fi

if [ ! -e "package.json" ]
then
  echo "no package.json, exiting..."
  exit
fi

pnpm run dev

