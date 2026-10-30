# Build environment

- The user builds this project on a remote Ubuntu server. Run Node.js builds, checks, and WebExtension packaging there; do not assume the current environment is a Mac.
- Generating, signing, and installing Safari's iOS/macOS apps requires a separate Mac with Xcode.

# Artifact packaging

- Package one target with `npm run package -- safari` or `npm run package -- firefox`.
- Store release archives in `artifacts/<version>/`; preserve other targets and earlier versions.
- Keep relative directory symlinks `artifacts/v<version>` and `artifacts/latest`, with `latest` pointing to the highest packaged version.
- Safari's ZIP contains shared WebExtension resources for macOS and iOS; platform-specific apps require Xcode on macOS.
- Never package or retain source archives. Git is the source of truth.
