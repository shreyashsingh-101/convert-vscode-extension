# Convert VSCode Extension

A Visual Studio Code extension for uploading JavaScript and CSS files directly to Convert.com experiments and global project code.

## Features

- Connect with a Convert API key and manual account ID.
- Connect with Convert OAuth using a configurable OAuth client ID.
- Select account, project, experiment, and variation from searchable dropdowns.
- Push code to a selected variation or to Global JS/CSS.
- Drag and drop `.js` and `.css` files from VS Code.
- Persist and restore saved configuration across reloads.
- Clear all local extension state from the sidebar.
- Show the next CDN update time after a successful upload.

## How It Works

1. Enter an API key and account ID, or save a Convert OAuth client ID and log in with Convert.
2. Click **Load Projects**.
3. Select a project, experiment, and variation.
4. Drag `.js` or `.css` files into the extension drop zone.
5. Click **Push to Convert**.
6. After a successful upload, the extension shows the next CDN update time when Convert returns one.

## Local Development

1. Clone the repository.
2. Run `npm install`.
3. Run `npm run compile`.
4. Press `F5` in VS Code to launch an Extension Development Host.
5. Open **Convert VSCode Extension** from the Activity Bar.

## Notes

- OAuth client IDs are stored in VS Code secret storage.
- OAuth tokens and account lists are stored in VS Code secret storage.
- API key configuration is restored from extension global state.

## License

MIT License.
