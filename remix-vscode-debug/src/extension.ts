/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import * as path from 'path';
import * as solc from 'solc';
import * as fs from 'fs';
import { isContext } from 'vm';

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.commands.registerCommand('extension.solidity-debug.getConstructorArgs', config => {
		return vscode.window.showInputBox({
			placeHolder: config.constructorParamsDef,
			prompt: "Please input the constructor arguments"
		})
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

		let contractFilePath = activeTextEditor.document.fileName;

		config.contractFilePath = contractFilePath;

		const contractCode = fs.readFileSync(contractFilePath, 'utf8');

		const contractName = path.basename(contractFilePath, '.sol');

		const compilerOutput = JSON.parse(solc.compileStandardWrapper(this.compilerOptions(contractName, contractCode)));

	  config.compilerOutput = compilerOutput;

		config.contractByteCode = compilerOutput.contracts[contractName + '.sol'][contractName].evm.bytecode;

		const contractAbi = compilerOutput.contracts[contractName + '.sol'][contractName].abi;
		config.contractAbi = contractAbi;

		for (var i = 0; i < contractAbi.length; i++) {
      if (contractAbi[i].type === 'constructor') {
			  const constructorInputs = contractAbi[i].inputs ;
				let parameters = '';
				if (constructorInputs) {
					constructorInputs.forEach(function(prop) {
						if (parameters !== '') {
							parameters += ', '
						}
						parameters += prop['type'] + ' ' + prop['name']
					});
				}

				if (parameters !== '') {
					config.constructorParamsDef = parameters;
					config.constructorArgs = "${command:AskForConstructorArgs}";
				}

        break
			}
		}

		/*
		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {

			if (activeTextEditor && activeTextEditor.document.languageId === 'solidity' ) {
				config.type = 'solidity';
				config.name = 'Launch';
				config.request = 'launch';
				config.stopOnEntry = true;
			}
		}
		*/

		return config;
	}

 	compilerOptions (contractName: string, contractCode: string) {

		return JSON.stringify({
			language: 'Solidity',
			sources: {
				[contractName +'.sol']: {
					content: contractCode
				}
			},
			settings: {
				optimizer: {
					enabled: false,
					runs: 200
				},
				outputSelection: {
					'*': {
						'': [ 'legacyAST' ],
						'*': [ 'abi', 'metadata', 'evm.legacyAssembly', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers', 'evm.gasEstimates' ]
					}
				}
			}
		})
	}
}
