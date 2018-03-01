/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { readFileSync } from 'fs';
import { EventEmitter } from 'events';

import * as path from 'path';

import * as ganache from 'ganache-core';
import * as Web3 from 'web3';

import { EventManager, init } from 'remix-lib';
//var remixLib = require('remix-lib');
//var global = remixLib.global;

declare var global: any;

import { trace, code } from 'remix-core';
import { SolidityProxy, InternalCallTree } from 'remix-solidity';

import * as EthJSVM from 'ethereumjs-vm';
import * as StateManager from 'ethereumjs-vm/lib/stateManager';
import { CompilationResult } from './solidityCompiler';

export interface SolidityBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}


/**
 * A Solidity runtime with minimal debugger functionality.
 */
export class SolidityRuntime extends EventEmitter {

	// the initial (and one and only) file we are 'debugging'
	private _sourceFile: string;
	public get sourceFile() {
		return this._sourceFile;
	}

	private _eventManager: EventManager = new EventManager();
	public get eventManager() {
		return this._eventManager;
	}

	// the contents (= lines) of the one and only file
	private _sourceLines: string[];

	// This is the next line that will be 'executed'
	private _currentLine = 0;

	// maps from sourceFile to array of Mock breakpoints
	private _breakPoints = new Map<string, SolidityBreakpoint[]>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId = 1;

	private _currentStepIndex = -1;

	private _contract: any;
	public get contract() {
		return this._contract;
	}



	private _transaction: any;
	public get transaction() {
		return this._transaction;
	}

	private _transactionReceipt: any;
	public get transactionReceipt() {
		return this._transactionReceipt;
	}

	constructor() {
		super();
	}

	private async deploy(constructorArgs: any[], compilationResult: CompilationResult) {

		const contractFilePath = compilationResult.source.target;

		const contractName = path.basename(contractFilePath, '.sol');

		const compilerOutput = compilationResult.data;
	  const contractAbi = compilerOutput.contracts[contractFilePath][contractName].abi;
		const contractByteCode = compilerOutput.contracts[contractFilePath][contractName].evm.bytecode;

		try {

			const accounts = await this.getAccounts();
			const byteCode = contractByteCode.object;
			const gasEstimate = await this.estimateGas(byteCode);

			this._contract = await this.deployContract(accounts[0], constructorArgs, gasEstimate, compilationResult);

			console.log("Contract Address: " + this._contract.address);

			this._transaction = await this.getTransaction(this._contract.transactionHash);
			this._transactionReceipt = await this.getTransactionReceipt(this._contract.transactionHash);
/*
			const debugTrace = await this.getTrace(contract.transactionHash);

			console.log("Debug Trace: " + debugTrace.gas);

			console.log("Transaction Block Number: " + this._transaction.blockNumber);
			console.log("Transaction Gas: " + this._transaction.gas);
			console.log("Transaction Gas Price: " + this._transaction.gasPrice);

			this._eventManager.trigger('newTraceRequested', [this._transaction.blockNumber, this._transaction.hash, this._transaction])
*/
		} catch(error) {
			console.log(error);
		}
	}

	public estimateGas(byteCode: string) {
		return new Promise<number>( (resolve, reject) => {
			global.web3.eth.estimateGas( {data: byteCode}, (error, result) => {
					if(error !== null)
						reject(error);
					else
						resolve(result);
				});
		});
	}

	public getAccounts() {
		return new Promise((resolve, reject) => {
			global.web3.eth.getAccounts((error, result) => {
				if(error !== null)
					reject(error);
				else
					resolve(result);
			});
		});
	}

	public deployContract(account: string, constructorArgs: any[], gasEstimate: number, compilationResult: CompilationResult) {

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
							//resolve(result);
							console.log("Transaction Hash: " + result.transactionHash);
					} else {
						// check address on the second call (contract deployed)
						resolve(result)
						console.log("Address: " + result.address);
							//resolve((result) => { if (result.address) return result });
					}
				}
			})
		});
	}

	public getTransaction(transactionHash: string) {
		return new Promise<any>( (resolve, reject) => {
			global.web3.eth.getTransaction(transactionHash, (error, result) => {
				if(error !== null)
					reject(error);
				else
					resolve(result);
			});
		});
	}

	public getTransactionReceipt(transactionHash: string) {
		return new Promise<any>( (resolve, reject) => {
			global.web3.eth.getTransactionReceipt(transactionHash, (error, result) => {
				if(error !== null)
					reject(error);
				else
					resolve(result);
			});
		});
	}

	public getTrace(transactionHash: string) {
		return new Promise<any>( (resolve, reject) => {

			global.web3.debug.traceTransaction(transactionHash,
				{ disableStorage: true,
				disableMemory: false,
				disableStack: false,
				fullStorage: false
			}
			/*
			global.web3.currentProvider.sendAsync({
			method: "debug_traceTransaction",
			params: [transactionHash,
				{ disableStorage: true,
					disableMemory: false,
					disableStack: false,
					fullStorage: false
				}],
			jsonrpc: "2.0",
			id: "2"
			}
			*/
			, (error, result) => {

				if (error !== null)
					reject(error)
				else
					resolve(result)

			});
		})
	}


	/**
	 * Start executing the given program.
	 */
	public start(compilationResult: CompilationResult, constructorArgs: any[], stopOnEntry: boolean) {

		const contractFilePath = compilationResult.source.target;

		global.web3 = new Web3(ganache.provider({
			"accounts": [
				{ "balance": "100000000000000000000" }
			],
			"locked": false
		}));

		init.extendWeb3(global.web3);


		//this.deploy(constructorArgs, compilationResult);

		this.loadSource(contractFilePath);
		this._currentLine = -1;

		this.verifyBreakpoints(this._sourceFile);

		if (stopOnEntry) {
			// we step once
			this.step(false, 'stopOnEntry');
		} else {
			// we just start to run until we hit a breakpoint or an exception
			this.continue();
		}
	}

	/**
	 * Continue execution to the end/beginning.
	 */
	public continue(reverse = false) {
		this.run(reverse, undefined);
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public step(reverse = false, event = 'stopOnStep') {
		this.run(reverse, event);
	}

	/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public stack(startFrame: number, endFrame: number): any {

		const words = this._sourceLines[this._currentLine].trim().split(/\s+/);

		const frames = new Array<any>();
		// every word of the current line becomes a stack frame.
		for (let i = startFrame; i < Math.min(endFrame, words.length); i++) {
			const name = words[i];	// use a word of the line as the stackframe name
			frames.push({
				index: i,
				name: `${name}(${i})`,
				file: this._sourceFile,
				line: this._currentLine
			});
		}
		return {
			frames: frames,
			count: words.length
		};
	}

	/*
	 * Set breakpoint in file with given line.
	 */
	public setBreakPoint(path: string, line: number) : SolidityBreakpoint {

		const bp = <SolidityBreakpoint> { verified: false, line, id: this._breakpointId++ };
		let bps = this._breakPoints.get(path);
		if (!bps) {
			bps = new Array<SolidityBreakpoint>();
			this._breakPoints.set(path, bps);
		}
		bps.push(bp);

		this.verifyBreakpoints(path);

		return bp;
	}

	/*
	 * Clear breakpoint in file with given line.
	 */
	public clearBreakPoint(path: string, line: number) : SolidityBreakpoint | undefined {
		let bps = this._breakPoints.get(path);
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				return bp;
			}
		}
		return undefined;
	}

	/*
	 * Clear all breakpoints for file.
	 */
	public clearBreakpoints(path: string): void {
		this._breakPoints.delete(path);
	}

	// private methods

	private loadSource(file: string) {
		if (this._sourceFile !== file) {
			this._sourceFile = file;
			this._sourceLines = readFileSync(this._sourceFile).toString().split('\n');
		}
	}

	/**
	 * Run through the file.
	 * If stepEvent is specified only run a single step and emit the stepEvent.
	 */
	private run(reverse = false, stepEvent?: string) {
		if (reverse) {
			for (let ln = this._currentLine-1; ln >= 0; ln--) {
				if (this.fireEventsForLine(ln, stepEvent)) {
					this._currentLine = ln;
					return;
				}
			}
			// no more lines: stop at first line
			this._currentLine = 0;
			this.sendEvent('stopOnEntry');
		} else {
			for (let ln = this._currentLine+1; ln < this._sourceLines.length; ln++) {

				//this._codeManager.resolveStep(index, this._transaction);

				if (this.fireEventsForLine(ln, stepEvent)) {
					this._currentLine = ln;
					return true;
				}
			}
			// no more lines: run to end
			this.sendEvent('end');
		}
	}

	private verifyBreakpoints(path: string) : void {
		let bps = this._breakPoints.get(path);
		if (bps) {
			this.loadSource(path);
			bps.forEach(bp => {
				if (!bp.verified && bp.line < this._sourceLines.length) {
					const srcLine = this._sourceLines[bp.line].trim();

					// if a line is empty or starts with '+' we don't allow to set a breakpoint but move the breakpoint down
					if (srcLine.length === 0 || srcLine.indexOf('+') === 0) {
						bp.line++;
					}
					// if a line starts with '-' we don't allow to set a breakpoint but move the breakpoint up
					if (srcLine.indexOf('-') === 0) {
						bp.line--;
					}
					// don't set 'verified' to true if the line contains the word 'lazy'
					// in this case the breakpoint will be verified 'lazy' after hitting it once.
					if (srcLine.indexOf('lazy') < 0) {
						bp.verified = true;
						this.sendEvent('breakpointValidated', bp);
					}
				}
			});
		}
	}

	/**
	 * Fire events if line has a breakpoint or the word 'exception' is found.
	 * Returns true is execution needs to stop.
	 */
	private fireEventsForLine(ln: number, stepEvent?: string): boolean {

		const line = this._sourceLines[ln].trim();

		// if 'log(...)' found in source -> send argument to debug console
		const matches = /log\((.*)\)/.exec(line);
		if (matches && matches.length === 2) {
			this.sendEvent('output', matches[1], this._sourceFile, ln, matches.index)
		}

		// if word 'exception' found in source -> throw exception
		if (line.indexOf('exception') >= 0) {
			this.sendEvent('stopOnException');
			return true;
		}

		// is there a breakpoint?
		const breakpoints = this._breakPoints.get(this._sourceFile);
		if (breakpoints) {
			const bps = breakpoints.filter(bp => bp.line === ln);
			if (bps.length > 0) {

				// send 'stopped' event
				this.sendEvent('stopOnBreakpoint');

				// the following shows the use of 'breakpoint' events to update properties of a breakpoint in the UI
				// if breakpoint is not yet verified, verify it now and send a 'breakpoint' update event
				if (!bps[0].verified) {
					bps[0].verified = true;
					this.sendEvent('breakpointValidated', bps[0]);
				}
				return true;
			}
		}

		// non-empty line
		if (stepEvent && line.length > 0) {
			this.sendEvent(stepEvent);
			return true;
		}

		// nothing interesting found -> continue
		return false;
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}