import * as vscode from "vscode";
import {
  handleCreateExperimentMessage,
  handleMessage,
} from "../../utils/messageHandler";
import { FileStore } from "../session/fileStore";
import { SessionStore } from "../session/sessionStore";

export interface DispatchDependencies {
  context: vscode.ExtensionContext;
  fileStore: FileStore;
  sessionStore: SessionStore;
}

export interface DispatchResult {
  messages: Array<Record<string, unknown>>;
}

function createSink(messages: Array<Record<string, unknown>>) {
  return {
    postMessage: async (message: Record<string, unknown>) => {
      messages.push(message);
      return true;
    },
  };
}

export async function dispatchMessage(
  message: Record<string, unknown>,
  dependencies: DispatchDependencies,
): Promise<DispatchResult> {
  const messages: Array<Record<string, unknown>> = [];

  await handleMessage(
    message,
    createSink(messages),
    dependencies.fileStore,
    dependencies.context,
    dependencies.sessionStore,
  );

  return { messages };
}

export async function dispatchCreateExperiment(
  message: Record<string, unknown>,
  dependencies: DispatchDependencies,
): Promise<DispatchResult> {
  const messages: Array<Record<string, unknown>> = [];

  await handleCreateExperimentMessage(
    message,
    createSink(messages),
    dependencies.context,
    async () => undefined,
  );

  return { messages };
}

export function findMessage<T extends Record<string, unknown>>(
  messages: Array<Record<string, unknown>>,
  command: string,
): T | undefined {
  return messages.find((message) => message.command === command) as T | undefined;
}
