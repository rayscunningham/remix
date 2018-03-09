/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {
	Logger, logger,
	DebugSession, LoggingDebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { basename } from 'path';
import { SolidityRuntime, SolidityBreakpoint, TransactionTrace } from './solidityRuntime';

import { SourceMappingDecoder, EventManager, helpers, util, global } from 'remix-lib';;

import { trace, code } from 'remix-core';
import { SolidityProxy, InternalCallTree } from 'remix-solidity';

import * as path from 'path';
import * as fs from 'fs';

import { CompilationResult } from './solidityCompiler';
import { SolidityBreakpointManager } from './solidityBreakpointManager';
import { SolidityStepManager } from './solidityStepManager';
/**
 * This interface describes the mock-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the mock-debug extension.
 * The interface should always match this schema.
 */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "contract" to debug. */
	//compilerOutput: any;

	compilationResult: CompilationResult;

	contractFilePath: string;

	constructorParamsDef?: string;

	constructorArgs?: string;

	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
}

export interface SolidityBreakpoint {
	id: number;
	file: string;
	line: number;
	verified: boolean;
}

export class SolidityDebugSession extends LoggingDebugSession {

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static THREAD_ID = 1;

	private _runtime: SolidityRuntime;

	private _variableHandles = new Handles<string>();

	private _stopOnEntry?: boolean;

	private _eventManager: EventManager;
	public get event() {
		return this._eventManager;
	}

	private _traceManager: trace.TraceManager;
	public get traceManager() {
		return this._traceManager;
	}

	private _codeManager: code.CodeManager;
	public get codeManager() {
		return this._codeManager;
	}

	private _solidityProxy: SolidityProxy;
	public get solidityProxy() {
		return this._solidityProxy;
	}

	private _internalCallTree: InternalCallTree;
	public get callTree() {
		return this._internalCallTree;
	}

	private _breakpointManager: SolidityBreakpointManager;
	public get breakpointManager() {
		return this._breakpointManager;
	}

	private _stepManager: SolidityStepManager;
	public get stepManager() {
		return this._stepManager;
	}

	private _sourceFile : string;
	public get sourceFile() {
		return this._sourceFile;
	}

	private _sourceMappingDecoder: SourceMappingDecoder;

	private _lineBreakPositionsByContent: any = [];

	private _compilationResult: CompilationResult;

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super("solidity-debug.txt");

		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);

		this._runtime = new SolidityRuntime();

		this._eventManager = new EventManager();

		this._traceManager = new trace.TraceManager();
		this._codeManager = new code.CodeManager(this._traceManager);
		this._solidityProxy = new SolidityProxy(this._traceManager, this._codeManager)

		this._internalCallTree = new InternalCallTree(this._eventManager, this._traceManager, this._solidityProxy, this._codeManager, { includeLocalVariables: true })

		this._sourceMappingDecoder = new SourceMappingDecoder();

		this._breakpointManager = new SolidityBreakpointManager(this);
		this._stepManager = new SolidityStepManager(this);

		this._codeManager.event.register('changed', this, (code, address, instIndex) => {
			this._internalCallTree.sourceLocationTracker.getSourceLocationFromVMTraceIndex(address, this._stepManager.currentStepIndex, this.solidityProxy.contracts, (error, sourceLocation) => {
				if (!error) {
					this.event.trigger('sourceLocationChanged', [sourceLocation])
				}
			})
		})

		// setup event handlers
		this._stepManager.on('stopOnEntry', () => {
			this.sendEvent(new StoppedEvent('entry', SolidityDebugSession.THREAD_ID));
		});
		this._stepManager.on('stopOnStep', () => {
			this.sendEvent(new StoppedEvent('step', SolidityDebugSession.THREAD_ID));
		});
		this._breakpointManager.on('stopOnBreakpoint', () => {
			this.sendEvent(new StoppedEvent('breakpoint', SolidityDebugSession.THREAD_ID));
		});
		this._stepManager.on('stopOnException', () => {
			this.sendEvent(new StoppedEvent('exception', SolidityDebugSession.THREAD_ID));
		});
		this._breakpointManager.on('breakpointValidated', (bp: SolidityBreakpoint) => {
			this.sendEvent(new BreakpointEvent('changed', <DebugProtocol.Breakpoint>{ verified: bp.verified, id: bp.id }));
		});
		this._stepManager.on('output', (text, filePath, line, column) => {
			const e: DebugProtocol.OutputEvent = new OutputEvent(`${text}\n`);
			e.body.source = this.createSource(filePath);
			e.body.line = this.convertDebuggerLineToClient(line);
			e.body.column = this.convertDebuggerColumnToClient(column);
			this.sendEvent(e);
		});
		this._stepManager.on('end', () => {
			this.sendEvent(new TerminatedEvent());
		});
	}

	private offsetToLineColumn(rawLocation, file, compilationResult) {

		if (!this._lineBreakPositionsByContent[file]) {
			let filename = Object.keys(compilationResult.data.sources)[file]
			this._lineBreakPositionsByContent[file] = this._sourceMappingDecoder.getLinebreakPositions(compilationResult.source.sources[filename].content)
		}

		return this._sourceMappingDecoder.convertOffsetToLineColumn(rawLocation, this._lineBreakPositionsByContent[file])
	}

	private debugTransaction(transaction: any) : Promise<void> {
		const debugSession = this;

		return new Promise<void>((resolve, reject) => {

			transaction.to = helpers.trace.contractCreationToken('0');

			const self = debugSession;
			debugSession._traceManager.resolveTrace(transaction, function (error, result) {
				if (result) {

					self._stepManager.changeState(0);
					self._eventManager.trigger('newTraceLoaded', [self._traceManager.trace]);

					/*
					if (self._breakpointManager && self._breakpointManager.hasBreakpoint()) {
						self._breakpointManager.jumpNextBreakpoint(false);
					}
					*/
					resolve();
				} else {
					//self.statusMessage = error ? error.message : 'Trace not loaded'
					//yo.update(self.view, self.render())

					reject(error);
				}
			});
		});
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;

		// make VS Code to show a 'step back' button
		response.body.supportsStepBack = true;

		this.sendResponse(response);
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {

		this._stopOnEntry = args.stopOnEntry;
		this._compilationResult = args.compilationResult;

		const compilerOutput = this._compilationResult.data;

		this._solidityProxy.reset(compilerOutput);

		const contractFilePath = args.contractFilePath;
		const contractName = path.basename(contractFilePath, '.sol');
		const contractAbi = compilerOutput.contracts[contractFilePath][contractName].abi;

		let constructorArgs: any[] = [];
		if (args.constructorArgs !== undefined) {
			constructorArgs = args.constructorArgs.split(',');

			const abi = contractAbi;
			for (var i = 0; i < abi.length; i++) {
				if (abi[i].type === 'constructor') {
					const constructorInputs = abi[i].inputs ;
					for (var i = 0; i < constructorInputs.length; i++) {
						//inputTypes.push(constructorInputs[i].type)
						constructorArgs[i] = Number(constructorArgs[i]);
					}

					break;
				}
			}
		}

		// make sure to 'Stop' the buffered logging if 'trace' is not set
		logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

		this._sourceFile = args.contractFilePath;

		this._runtime.deploy(constructorArgs, this._compilationResult)
			.then(transactionTrace => {
				this.debugTransaction.bind(this);
				return this.debugTransaction(transactionTrace.transaction);
			})
			.then(() => {

				if (this._stopOnEntry) {
					// we step once
					this._stepManager.step(false, 'stopOnEntry');
				} else {
					// we just start to run until we hit a breakpoint or an exception
					this._stepManager.continue();
				}

				this.sendResponse(response);
			})


		//if (compilationResult && compilationResult.sources && compilationResult.contracts) {


		const contractCode = fs.readFileSync(contractFilePath, 'utf8');

		let nodes = this._sourceMappingDecoder.nodesAtPosition(null, 0, compilerOutput.sources[contractFilePath])

		var position = this._sourceMappingDecoder.decode(nodes[0].src);

		//var lineColumn = offsetToLineColumnConverter.offsetToLineColumn(position, position.file, compiler.lastCompilationResult)
		let lineBreakPositionsByContent = {};

			if (!lineBreakPositionsByContent[position.file]) {
				var filename = Object.keys(compilerOutput.sources)[position.file]
				lineBreakPositionsByContent[position.file] = this._sourceMappingDecoder.getLinebreakPositions(contractCode)
			}
			let lineColumn = this._sourceMappingDecoder.convertOffsetToLineColumn(position, lineBreakPositionsByContent[position.file])


/*
		this._traceManager.getCurrentCalledAddressAt(1, (error, result) => {
			if (error)
				console.log(error);
			else
			  console.log(result);
		});
		*/
		//} else {
		//	this.solidityProxy.reset({})
		//}


		//this.sendResponse(response);
	}

  /**
    * Triggered for every breakpoint add or remove.  Entire breakpoint array for the file is always passed.
    *
    * @param {Object} sourceLocation - position of the breakpoint { file: '<file index>', row: '<line number' }
    */
	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

		const path = <string>args.source.path;
		const clientLines = args.lines || [];

		// clear all breakpoints for this file
		this._breakpointManager.clearBreakpoints(path);

		const actualBreakpoints = clientLines.map(l => {
			let { verified, line, id } = this._breakpointManager.setBreakPoint(path, this.convertClientLineToDebugger(l));
			const bp = <DebugProtocol.Breakpoint> new Breakpoint(verified, this.convertDebuggerLineToClient(line));
			bp.id= id;
			return bp;
		});

		// send back the actual breakpoint positions
		response.body = {
			breakpoints: actualBreakpoints
		};

		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// runtime supports now threads so just return a default thread.
		response.body = {
			threads: [
				new Thread(SolidityDebugSession.THREAD_ID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

		const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		const endFrame = startFrame + maxLevels;

		const stk = this._stepManager.stack(startFrame, endFrame);

		response.body = {
			stackFrames: stk.frames.map(f => new StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line))),
			totalFrames: stk.count
		};

		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

		const frameReference = args.frameId;
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Local", this._variableHandles.create("local_" + frameReference), false));
		//scopes.push(new Scope("Global", this._variableHandles.create("global_" + frameReference), true));

		scopes.push(new Scope("Transaction", this._variableHandles.create("tx_" + frameReference), true));

		response.body = {
			scopes: scopes
		};

		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {

		const variables = new Array<DebugProtocol.Variable>();
		const id = this._variableHandles.get(args.variablesReference);
		if (id !== null) {
/*
			if (id.startsWith("tx_")) {

				const inputData = this._runtime.transaction.input.replace('0x', '')
				const bytecode = this._runtime.contractByteCode.object;

				variables.push({
					name: "blockHash",
					type: "string",
					value: String(this._runtime.transactionReceipt.blockHash),
					variablesReference: 0
				});
				variables.push({
					name: "blockNumber",
					type: "integer",
					value: String(this._runtime.transactionReceipt.blockNumber),
					variablesReference: 0
				});
				variables.push({
					name: "transactionHash",
					type: "string",
					value: String(this._runtime.transactionReceipt.transactionHash),
					variablesReference: 0
				});
				variables
				variables.push({
					name: "transactionIndex",
					type: "integer",
					value: String(this._runtime.transactionReceipt.transactionIndex),
					variablesReference: 0
				});
				variables.push({
					name: "from",
					type: "string",
					value: String(this._runtime.transactionReceipt.from),
					variablesReference: 0
				});
				variables.push({
					name: "to",
					type: "string",
					value: this._runtime.transactionReceipt.to,
					variablesReference: 0
				});
				variables.push({
					name: "cumulativeGasUsed",
					type: "integer",
					value: String(this._runtime.transactionReceipt.cumulativeGasUsed),
					variablesReference: 0
				});
				variables.push({
					name: "gasUsed",
					type: "integer",
					value: String(this._runtime.transactionReceipt.gasUsed),
					variablesReference: 0
				});

				variables.push({
					name: "input",
					type: "string",
					value: String(this._runtime.transaction.input),
					variablesReference: 0
				});

				variables.push({
					name: "logs",
					type: "object",
					value: String(this._runtime.transactionReceipt.logs),
					variablesReference: this._variableHandles.create("logs_")
				});


			} else {
				variables.push({
					name: id + "_i",
					type: "integer",
					value: "123",
					variablesReference: 0
				});
				variables.push({
					name: id + "_f",
					type: "float",
					value: "3.14",
					variablesReference: 0
				});
				variables.push({
					name: id + "_s",
					type: "string",
					value: "hello world",
					variablesReference: 0
				});
				variables.push({
					name: id + "_o",
					type: "object",
					value: "Object",
					variablesReference: this._variableHandles.create("object_")
				});

			}

			*/
		}

		response.body = {
			variables: variables
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this._stepManager.continue();
		this.sendResponse(response);
	}

	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments) : void {
		this._stepManager.continue(true);
		this.sendResponse(response);
 	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this._stepManager.step();

		this.sendResponse(response);
	}

	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
		this._stepManager.step(true);
		this.sendResponse(response);
	}
/*
	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		//this._runtime.step(true);
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		//this._runtime.step(true);
		this.sendResponse(response);
	}
*/

	private resolveToReducedTrace(value, incr) {
		if (this._internalCallTree.reducedTrace.length) {
			var nextSource = util.findClosestIndex(value, this._internalCallTree.reducedTrace)
			nextSource = nextSource + incr
			if (nextSource <= 0) {
				nextSource = 0
			} else if (nextSource > this._internalCallTree.reducedTrace.length) {
				nextSource = this._internalCallTree.reducedTrace.length - 1
			}
			return this._internalCallTree.reducedTrace[nextSource]
		}
		return value
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {

		let reply: string | undefined = undefined;

		if (args.context === 'repl') {
			// 'evaluate' supports to create and delete breakpoints from the 'repl':
			const matches = /new +([0-9]+)/.exec(args.expression);
			if (matches && matches.length === 2) {
				const mbp = this._breakpointManager.setBreakPoint(this._sourceFile, this.convertClientLineToDebugger(parseInt(matches[1])));
				const bp = <DebugProtocol.Breakpoint> new Breakpoint(mbp.verified, this.convertDebuggerLineToClient(mbp.line), undefined, this.createSource(this._sourceFile));
				bp.id= mbp.id;
				this.sendEvent(new BreakpointEvent('new', bp));
				reply = `breakpoint created`;
			} else {
				const matches = /del +([0-9]+)/.exec(args.expression);
				if (matches && matches.length === 2) {
					const mbp = this._breakpointManager.clearBreakPoint(this._sourceFile, this.convertClientLineToDebugger(parseInt(matches[1])));
					if (mbp) {
						const bp = <DebugProtocol.Breakpoint> new Breakpoint(false);
						bp.id= mbp.id;
						this.sendEvent(new BreakpointEvent('removed', bp));
						reply = `breakpoint deleted`;
					}
				}
			}
		}

		response.body = {
			result: reply ? reply : `evaluate(context: '${args.context}', '${args.expression}')`,
			variablesReference: 0
		};
		this.sendResponse(response);
	}

	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'solidity-adapter-data');
	}
}

DebugSession.run(SolidityDebugSession);
