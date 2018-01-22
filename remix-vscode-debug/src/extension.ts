/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import * as path from 'path';


export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.commands.registerCommand('extension.solidity-debug.getConstructorArgs', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the constructor arguments",
		});
	}));

	// register a configuration provider for 'solidity' debug type
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('solidity', new SolidityConfigurationProvider()));

}

export function deactivate() {
	// nothing to do
}

class SolidityConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		if (vscode.workspace.rootPath === undefined) {
			vscode.window.showWarningMessage('Please open a folder in Visual Studio Code as a workspace');
			return;
		}

		const activeTextEditor = vscode.window.activeTextEditor;

		if (!activeTextEditor) {
			vscode.window.showWarningMessage('Please select a solidity file for debugging.');
			return;
		}

		if (path.extname(activeTextEditor.document.fileName) !== '.sol') {
			vscode.window.showWarningMessage('Selected file is not a solidity file (*.sol)');
			return;
		}

		config.contract = activeTextEditor.document.fileName;

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {

			if (activeTextEditor && activeTextEditor.document.languageId === 'solidity' ) {
				config.type = 'solidity';
				config.name = 'Launch';
				config.request = 'launch';
				config.stopOnEntry = true;
			}
		}

		return config;
	}
}
