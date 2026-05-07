# Convert VSCode Extension

A Visual Studio Code extension for uploading JavaScript, CSS, and images directly to Convert.com projects, experiments, variations, and global project code, with an additional local server workflow for AB Codeflame server setups.

## Features

- Connect with a Convert API key and manual account ID.
- Connect with Convert OAuth using a configurable OAuth client ID.
- Select account, project, experiment, and variation from searchable dropdowns.
- Push code to a selected variation or to Global JS/CSS.
- Open Convert JS/CSS in local editor files, then push saved editor changes.
- Drag and drop `.js` and `.css` files from VS Code.
- Upload one or more images to the Convert CDN.
- Configure and run local variation bundles from the sidebar server tab. Requires AB Codeflame server.
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

## Server Workflow

The sidebar also includes a dedicated **Server** tab for preparing and running local variation bundles.

- This feature requires AB Codeflame server.
- Provide the AB Codeflame server folder path and the experiment root/test folder path.
- Add one or more variations with JS and CSS/SCSS/SASS entry files.
- Preview the generated `config.json`, save reusable server configs, or run the server directly from the extension.

## Extension Setup

### API Key

1. Open the Convert sidebar from the Activity Bar.
2. Keep the default API-key login mode.
3. Enter your Convert API key in `API_KEY:API_SECRET` format.
4. Enter your Convert account ID.
5. Click **Load Projects** and continue selecting the project, experiment, and variation.

### OAuth

1. Create Convert OAuth client. (Profile > OAuth Clients > New OAuth Client)
2. Add this callback URL to the OAuth client configuration:

   ```text
   https://shreyashsingh-101.github.io/convert-vscode-extension/callback
   ```

3. In the extension sidebar, click **Change Client ID**.
4. Save the OAuth client ID from Convert.
5. Click **Login with Convert** and approve access. Make sure to allow access to the account, projects, and experiments you want to work with. Give **Publish** access.
6. Select the account, load projects, and continue with the normal workflow.

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
- The server workflow requires an existing AB Codeflame server setup and updates that server's `config.json`.

## License

MIT License.
