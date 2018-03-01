/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SolidityCompiler, SolidityCompilerType, CompilationSource, CompilationResult } from './solidityCompiler';
import { Compiler } from 'remix-solidity';
import { SampleHelpers } from './sampleHelpers';

export function activate(context: vscode.ExtensionContext) {


	context.subscriptions.push(vscode.commands.registerCommand('extension.solidity-debug.getConstructorArgs',

	config => {

		return vscode.window.showInputBox({
			placeHolder: config.constructorParamsDef,
			prompt: "Please input the constructor arguments"
		})

	}

	//showQuickPick
	));

	// register a configuration provider for 'solidity' debug type
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('solidity', new SolidityConfigurationProvider()));

/*

	let commands = [
		vscode.commands.registerCommand('sample.showQuickPick', showQuickPick)
	];
	context.subscriptions.concat(commands);
	*/
}

export function deactivate() {
	// nothing to do
}

function showQuickPick()
    {
        // The code you place here will be executed every time your command is executed
        let items: Array<SampleHelpers.QuickPickItem> = [
            {
                id: 0,
                description: "description1",
                detail: "detail1",
                label: "label1"
            },
            {
                id: 1,
                description: "description2",
                detail: "detail2",
                label: "label2"
            },
            {
                id: 2,
                description: "description3",
                detail: "detail3",
                label: "label3"
            }
        ]
        let options: vscode.QuickPickOptions = {
            onDidSelectItem: (item: SampleHelpers.QuickPickItem) =>
            {
                vscode.window.setStatusBarMessage(item.label);
            },
            matchOnDescription: false,
            matchOnDetail: false,
            placeHolder: "la"
        }
        vscode.window.showQuickPick<SampleHelpers.QuickPickItem>(items, options).then((item: SampleHelpers.QuickPickItem) =>
        {
            let id = item.id;
            let label = item.label;
            SampleHelpers.printInformation(showQuickPick, `${label} with id ${id} was selected.`, item);
        })
    }
class SolidityConfigurationProvider implements vscode.DebugConfigurationProvider {

	private _solidityCompiler: SolidityCompiler;


	/*
	private _solidityCompiler = new Compiler((url, callback) => {

	});
	*/

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

		this._solidityCompiler = new SolidityCompiler(SolidityCompilerType.DEFAULT);

		//this._solidityCompiler.loadVersion(false, "https://ethereum.github.io/solc-bin/bin/soljson-v0.4.20+commit.3155dd80.js");
		const contractFile = path.basename(contractFilePath);

		let sources = { [contractFilePath]: {
			content: contractCode }};
		//sources[contractFile] = { contractCode };

		const compilationSource = <CompilationSource> {sources: sources, target: contractFilePath };

		const compilationResult = this._solidityCompiler.compile(compilationSource);
		const compilerOutput = compilationResult.data;

		if (compilerOutput.errors && compilerOutput.errors.length >= 0) {

			const outputChannel = vscode.window.createOutputChannel('Debugger Solidity Compilation');
			outputChannel.clear();

			//outputChannel.appendLine("Solidity Compiler Version: " + this._solidityCompiler.getVersion() );
			outputChannel.appendLine("");

			compilerOutput.errors.forEach((error) => {
				outputChannel.appendLine(error.formattedMessage);
			});

			outputChannel.show();

			vscode.window.showErrorMessage("Solidity compilation errors.  Please see output window for details.");

			return;
		}

		//config.compilerOutput = compilerOutput;
		config.compilationResult = compilationResult;
		//config.contractByteCode = compilerOutput.contracts[contractFilePath][contractName].evm.bytecode;

		const contractAbi = compilerOutput.contracts[contractFilePath][contractName].abi;
		//config.contractAbi = contractAbi;

		for (let i = 0; i < contractAbi.length; i++) {
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

				break;
			}

		}

		return config;




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

		//return config;
	}
}
