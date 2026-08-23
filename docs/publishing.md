# Publication guide

This guide prepares a Codex Controls release. Do not create a package until the
plug-in is ready for release.

## Publication files

- `marketplace/listing.md` contains the product-page text, search terms,
  privacy text, and image order.
- `marketplace/images/` contains the 1920 by 960 publication images.
- `SUPPORT.md` contains the public support process and data-use statement.
- `CHANGELOG.md` contains user-visible release notes.
- The manifest contains the author, project URL, support URL, and production
  icon paths.

Run this command when the default controls or publication design changes:

```sh
npm run generate:publication-assets
```

The command uses the actual key renderer and default action settings. It also
creates the correct plug-in and category icon sizes. ImageMagick is required.

## Release checks

1. Move the `Unreleased` changes in `CHANGELOG.md` to the release version.
2. Update the version in `package.json` and `manifest.json`.
3. Run the repository self-review workflow.
4. Run the format, lint, test, type, build, and validation checks.
5. Test all three actions with a local task. Confirm the value display with a
   remote task.
6. Review the marketplace text and images.
7. Confirm that the manifest does not enable the Node.js debugger.
8. Create and install the release package.

## Package command

Run this command only when the release is ready:

```sh
npm run package:plugin
```

The command builds the plug-in, copies only the runtime files to `dist/`,
validates that clean copy, and creates the `.streamDeckPlugin` file in `dist/`.
It does not include logs, source files, tests, or local Codex data.

The `dist/` directory and the package file are not tracked by Git.
