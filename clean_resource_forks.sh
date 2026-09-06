#!/bin/bash
while true; do
    find "/Volumes/Jason's SSD/DBReader/src-tauri/target" -name "._*" -type f -delete 2>/dev/null
    sleep 0.5
done
