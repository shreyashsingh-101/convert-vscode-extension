# Changelog

All notable changes to this project will be documented in this file.

## [0.0.4] - Latest

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
