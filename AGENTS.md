# Safari deployment

- Keep Safari ZIP artifacts in `artifacts/safari/`.
- Publish a stable relative symlink named `local-blocklist-latest-safari-webextension.zip` in that directory, pointing to the versioned ZIP produced by the latest successful packaging run.
- `npm run package` must update this symlink automatically after packaging completes, using an atomic replacement. Retain previous versioned archives.
- When delivering a Safari build, give the user the stable symlink path so the download/deployment script on the MacBook does not need a version change.
- Include this file in source archives so the deployment rule travels with the project.
