/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { EventEmitter } from 'events';

import * as path from 'path';

import * as ganache from 'ganache-core';
import * as Web3 from 'web3';

import  { EventManager, execution, global, init }from 'remix-lib';

import { CompilationResult } from './solidityCompiler';

export interface SolidityBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

export interface TransactionTrace {
	transaction: any;
	transactionReceipt: any;
	trace: any;
}
/**
 * A Solidity runtime with minimal debugger functionality.
 */
export class SolidityRuntime extends EventEmitter {


	private _eventManager: EventManager = new EventManager();
	public get eventManager() {
		return this._eventManager;
	}

	constructor() {
		super();
		this.init();
	}

	private init() {

		global.web3 = new Web3(ganache.provider({
			"accounts": [
				{ "balance": "100000000000000000000" }
			],
			"locked": false
		}));

		init.extendWeb3(global.web3);

		execution.executionContext.detectNetwork((error, network) => {
			if (error || !network) {
				global.web3Debug = global.web3
			} else {
				var webDebugNode = init.web3DebugNode(network.name)
				global.web3Debug = !webDebugNode ? global.web3 : webDebugNode
			}
		})
	}

	public deploy(constructorArgs: any[], compilationResult: CompilationResult): Promise<TransactionTrace> {

		const contractFilePath = compilationResult.source.target;

		const contractName = path.basename(contractFilePath, '.sol');

		const compilerOutput = compilationResult.data;
		const contractByteCode = compilerOutput.contracts[contractFilePath][contractName].evm.bytecode;
		const byteCode = contractByteCode.object;

		return Promise.all([this.getAccounts(), this.estimateGas(byteCode)])
			.then(values => {
				const accounts = values[0];
				const gasEstimate = values[1];

				return this.deployContract(accounts[0], constructorArgs, gasEstimate, compilationResult);
			})
			.then(contract => {
				const txHash = contract.transactionHash;

				return Promise.all([this.getTransaction(txHash),
					this.getTransactionReceipt(txHash),
					this.getTrace(txHash)]);
			})
			.then(values => {
				const tx = values[0];
				const txReceipt = values[1];
				const debugTrace = values[2];

				return <TransactionTrace> {transaction: tx, transactionReceipt: txReceipt, trace: debugTrace};
			})
	}

	public estimateGas(byteCode: string): Promise<number> {
		return new Promise<number>((resolve, reject) => {
			global.web3.eth.estimateGas( {data: byteCode}, (error, result) => {
					if(error !== null)
						reject(error);
					else
						resolve(result);
				});
		});
	}

	public getAccounts(): Promise<any> {
		return new Promise((resolve, reject) => {
			global.web3.eth.getAccounts((error, result) => {
				if(error !== null)
					reject(error);
				else
					resolve(result);
			});
		});
	}

	private deployContract(account: string, constructorArgs: any[], gasEstimate: number, compilationResult: CompilationResult) : Promise<any> {
		return new Promise<any>((resolve, reject) => {
			const contractFilePath = compilationResult.source.target;
			const contractName = path.basename(contractFilePath, '.sol');
			const compilerOutput = compilationResult.data;
			const contractAbi = compilerOutput.contracts[contractFilePath][contractName].abi;
			const contractByteCode = compilerOutput.contracts[contractFilePath][contractName].evm.bytecode;

      global.web3.eth.contract(contractAbi).new(constructorArgs, {
				data: '0x' + contractByteCode.object,
				from: account,
				gas: gasEstimate + 40000
			}, (error, result) => {
				if(error !== null)
						reject(error);
				else {
					// NOTE: The callback will fire twice!
					// Once the contract has the transactionHash property set and once its deployed on an address.

					// e.g. check tx hash on the first call (transaction send)
					if (!result.address) {

							console.log("Transaction Hash: " + result.transactionHash);
					} else {
						// check address on the second call (contract deployed)
						resolve(result)
						console.log("Address: " + result.address);

					}
				}
			})

		});
	}

	public getTransaction(transactionHash: string) : Promise<any> {
		return new Promise<any>((resolve, reject) => {
			global.web3.eth.getTransaction(transactionHash, (error, result) => {
				if(error !== null)
					reject(error);
				else
					resolve(result);
			});
		});
	}

	public getTransactionReceipt(transactionHash: string) : Promise<any> {
		return new Promise<any>((resolve, reject) => {
			global.web3.eth.getTransactionReceipt(transactionHash, (error, result) => {
				if(error !== null)
					reject(error);
				else
					resolve(result);
			});
		});
	}

	public getTrace(transactionHash: string) : Promise<any> {
		return new Promise<any>((resolve, reject) => {
			global.web3.debug.traceTransaction(transactionHash,
				{ disableStorage: true,
					disableMemory: false,
					disableStack: false,
					fullStorage: false
			}, (error, result) => {
				if (error !== null)
					reject(error);
				else
					resolve(result);
			});
		})
	}

	/**
	 * Start executing the given program.
	 */
	public start(compilationResult: CompilationResult, constructorArgs: any[], stopOnEntry: boolean): Promise<any> {

		return new Promise<any>((resolve, reject) => {
			const contractFilePath = compilationResult.source.target;

			global.web3 = new Web3(ganache.provider({
				"accounts": [
					{ "balance": "100000000000000000000" }
				],
				"locked": false
			}));

			init.extendWeb3(global.web3);

			/*
			this.deploy(constructorArgs, compilationResult)
				.then(transactionTrace => {

					const tx = transactionTrace.transaction;

					this.loadSource(contractFilePath);
					this._currentLine = -1;

					this.verifyBreakpoints(this._sourceFile);

					this._eventManager.trigger('newTraceRequested', [tx.blockNumber, tx.hash, tx])

					if (stopOnEntry) {
						// we step once
						this.step(false, 'stopOnEntry');
					} else {
						// we just start to run until we hit a breakpoint or an exception
						this.continue();
					}

					resolve();
			});
			*/
		});
	}


	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}