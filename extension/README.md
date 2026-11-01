# ComiHub Web Helper

This optional Manifest V3 helper lets ComiHub request source HTML and JSON directly from the browser. It does not read browsing history, inject page scripts, or execute downloaded source code.

## Chrome and Edge

Open the browser's extensions page, enable **Developer mode**, choose **Load unpacked**, and select this `extension` directory. For a packaged build, zip the contents of this directory and install it through the browser's developer-mode flow.

## Firefox

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `manifest.json` from this directory. A signed Firefox distribution can use the same files.

## iOS Safari

Safari Web Extensions require an Apple-hosted extension wrapper and signing through Xcode. Use the ComiHub iOS build's extension guide or the Safari Web Extension Converter, then enable the extension in iOS Settings → Apps → Safari → Extensions.

The helper only accepts external messages from `https://www.comihub.top`, `https://comihub.top`, and localhost development origins.
