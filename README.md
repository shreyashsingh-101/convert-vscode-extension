# Convert VSCode Extension

Convert VSCode Extension is a Visual Studio Code workflow for working with Convert experiments without leaving the editor. It supports direct JS/CSS pushes, image uploads, experiment creation, local AB Codeflame server config management, and an embedded MCP server that AI clients can use through the `ABTest Extension` endpoint.

## What's New in v0.0.9

- Added a full **Create Experiment** wizard with guided steps for basic info, locations, audiences, goals, variations, and review.
- Added a dedicated **AI / MCP** tab with embedded server status, health checks, logs, and copyable MCP config.
- Added broader MCP compatibility improvements, including better JSON-RPC errors, resource support, and `body` / `payload` handling for generic Convert API calls.
- Added cancellable Convert OAuth login from the sidebar so repeated login attempts do not get stuck behind a timeout.
- Improved the **Server** tab with safer defaults, reusable saved configs, and domain suggestions from previously saved setups.

## Core Features

- Connect with a Convert API key and manual account ID.
- Connect with Convert OAuth using a configurable OAuth client ID.
- Select account, project, experiment, and variation from searchable dropdowns.
- Push code to a selected variation or to Global JS/CSS.
- Open Convert JS/CSS in local editor files, then push saved editor changes.
- Drag and drop `.js` and `.css` files from VS Code.
- Upload one or more images to the Convert CDN.
- Create new experiments from the sidebar with existing or new locations, audiences, goals, and named variations.
- Configure and run local variation bundles from the sidebar **Server** tab. Requires AB Codeflame server.
- Use the embedded MCP server from AI tools through the `ABTest Extension` MCP server entry.
- Persist and restore sidebar selections, server configs, and workflow state across reloads.

## Sidebar Workflows

### Push Code to Convert

1. Enter an API key and account ID, or save a Convert OAuth client ID and log in with Convert.
2. Click **Load Projects**.
3. Select a project, experiment, and variation.
4. Drag `.js` or `.css` files into the extension drop zone, or open the editor workflow.
5. Click **Push to Convert**.

### Create an Experiment

1. Select an account and project in the main workflow.
2. Click **Create** next to the Experiment field.
3. Fill out the guided wizard:
   - Basic info
   - Location
   - Audience
   - Goals
   - Variations
   - Review
4. Submit the wizard to create the experiment and update the sidebar selection automatically.

### Upload Images

1. Switch to the **Image Upload** tab.
2. Select one or more supported image files.
3. Choose the target project.
4. Upload to the Convert CDN and copy or use the returned URLs.

### Server Workflow

The sidebar includes a dedicated **Server** tab for preparing and running local variation bundles.

- Requires AB Codeflame server.
- Configure the server folder path and experiment root/test folder path.
- Add one or more domains and variation entry files.
- Save reusable server configs with generated ids.
- Preview the generated `config.json` before running the server.
- Run the local server directly from the extension.

Default behavior in recent builds:

- New server configs default `clubJsCss` to `false`.
- New server configs default `minimize` to `true`.
- Domain inputs surface suggestion pills from previously saved configs.

### AI / MCP Workflow

The **AI / MCP** tab exposes an embedded local MCP server for AI clients.

- Inspect server status, endpoint, health, and protocol checks.
- Restart the embedded server or open MCP logs from the sidebar.
- Copy the generated MCP config directly from the extension.
- Register the server as `ABTest Extension` in your MCP client config.

Example generated MCP config:

```json
{
  "mcpServers": {
    "ABTest Extension": {
      "url": "http://localhost:8765/mcp"
    }
  }
}
```

## Authentication Setup

### API Key

1. Open the Convert sidebar from the Activity Bar.
2. Keep the default API-key login mode.
3. Enter your Convert API key in `API_KEY:API_SECRET` format.
4. Enter your Convert account ID.
5. Click **Load Projects** and continue selecting the project, experiment, and variation.

### OAuth

1. Create a Convert OAuth client in Convert.
2. Add this callback URL to the OAuth client configuration:

   ```text
   https://shreyashsingh-101.github.io/convert-vscode-extension/callback
   ```

3. In the extension sidebar, click **Change Client ID**.
4. Save the OAuth client ID from Convert.
5. Click **Login with Convert** and approve access.
6. If needed, click **Cancel login** from the sidebar to stop the pending auth request.
7. Select the account, load projects, and continue with the normal workflow.

## Local Development

1. Clone the repository.
2. Run `npm install`.
3. Run `npm run compile`.
4. Run `npm run lint`.
5. Press `F5` in VS Code to launch an Extension Development Host.
6. Open **Convert VSCode Extension** from the Activity Bar.

## Notes

- OAuth client IDs are stored in VS Code secret storage.
- OAuth tokens and account lists are stored in VS Code secret storage.
- API key configuration is restored from extension global state.
- The server workflow requires an existing AB Codeflame server setup and updates that server's `config.json`.
- The MCP server is local-only and is intended for desktop AI clients that support MCP over HTTP.

## License

MIT License.
