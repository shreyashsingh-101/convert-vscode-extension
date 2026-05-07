# Changelog

All notable changes to this project will be documented in this file.

## [0.0.7] - Latest

### Added

- Added a dedicated `Server` tab for local variation bundling and preview flow. Requires AB Codeflame server.
- Added reusable saved server configs with generated ids, search, new-config flow, clear options, and save confirmation.
- Added config preview support that writes and opens the generated `config.json` before running the server.
- Added path suggestions from currently open editor files for server folder, root/test folder, and variation entry files.

### Improved

- Improved server path handling for absolute paths, workspace-relative paths, and root-relative variation asset paths.
- Improved server validation, user-facing errors, and action feedback for save, preview, and run flows.
- Improved server domains input with add/remove controls and stricter empty-row handling.

### Fixed

- Fixed server tab state, saved-config selection, active-config tracking, and search/dropdown behavior.
- Fixed server config storage so saved entries use unique generated ids instead of config names.
- Fixed server output/config generation to align with the AB Codeflame server config structure under `experiments[0]`.
- Fixed macOS validation failures for JS/CSS paths selected from server suggestions or the file picker.
- Fixed server reset flows so `Server Folder Path` stays persisted across new-config and clear actions unless changed manually.

## [0.0.5]

### Added

- Added new multiple session support for editing and pushing JS/CSS across multiple projects, experiments, or variations.
- Added editor-based JS/CSS editing with open, close, and push controls per active session.
- Added a unified image upload view that supports single and multiple image uploads.
- Added safeguards for editor pushes, including active-session checks, saved-file checks, stale-session checks, and empty-editor checks.
- Added cleanup for old `.convert` temp files when opening a new editor session.

### Improved

- Limited dropdown previews to 5 visible items with the remaining result count shown below.
- Improved image upload validation for supported image types, empty files, duplicate extensions, and max file size.
- Improved JS/CSS upload validation for file type, empty files, real files, and max file size.
- Cleaned up the sidebar image upload flow and removed legacy single-image UI branches.

### Fixed

- Fixed editor pushes sending blank JS/CSS when editor files were never opened.
- Fixed stale editor files being pushable after changing project, experiment, or variation.
- Fixed editor controls staying active after generated editor tabs were closed.
- Fixed image upload table rendering so file names, statuses, and CDN URLs are escaped safely.

## [0.0.4]

### Added

- Added Convert OAuth login support.
- Added dynamic OAuth client ID storage through VS Code secrets.
- Added OAuth account dropdown populated from the OAuth response.
- Added a full **Clear All** action for saved config, OAuth state, and selected files.
- Added next CDN update toast after successful uploads.

### Improved

- Restored saved account, project, experiment, and variation selections more reliably.
- Kept project loading behind the **Load Projects** action for both API-key and OAuth modes.
- Hid the API-key/OAuth separator after OAuth login.
- Reduced release logging from Convert API calls.

### Fixed

- Fixed broken restore payload handling in the webview.
- Fixed TypeScript compile errors from top-level OAuth state access.
- Fixed stale webview search handlers that referenced missing DOM elements.
- Escaped file names and paths by rendering them as text nodes.

## [0.0.3]

### Added

- Hybrid search in dropdowns with local filtering and API search on Enter.
- Enter-triggered search for projects and experiments.
- Support for Global JS/CSS updates through the experience API.
- Global option in the variation dropdown.

### Improved

- Optimized dropdown behavior for large datasets.
- Reduced unnecessary API calls.

### Fixed

- Fixed dropdown reset issues after search.
- Fixed selection inconsistencies between search results and local state.

## [0.0.2]

### Added

- Ability to update Global JS/CSS at the experience level.
- Confirmation modal before pushing changes.
- Loading state and disabled submit button.
- Improved multi-file handling.

### Improved

- Cleaner UI layout and spacing.
- Persistent configuration for API key, account, and selections.
- Better drag-and-drop handling.

### Fixed

- Fixed extension crash after publishing due to incorrect file paths.
- Fixed media file loading issue after moving files from `src` to `media`.
- Fixed webview state reset on tab switch.

## [0.0.1]

### Added

- Initial API-key based Convert integration.
- Account, project, experiment, and variation selection.
- Drag-and-drop JS/CSS file selection.
- Push code directly to Convert variations.
- Custom searchable dropdown UI.
- JS/CSS file validation.
