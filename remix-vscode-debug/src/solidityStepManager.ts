import { EventEmitter } from 'events';
import * as path from 'path';
import { SolidityDebugSession } from './solidityDebug';
import { SourceMappingDecoder, util } from 'remix-lib';

export class SolidityStepManager extends EventEmitter {

	private _currentStepIndex: number = -1;
	public get currentStepIndex() {
		return this._currentStepIndex;
	}

	private _lineColumnPos: any;
	public get lineColumnPos() {
		return this._lineColumnPos;
	}

	private _sourceLocation: any;
	public get sourceLocation() {
		return this._sourceLocation;
	}

	private _currentLines = new Map<string, number>();

	private _sourceMappingDecoder: SourceMappingDecoder;

	private _lineBreakPositionsByContent: any = [];

	private _callstack: any;
	public get callstack() {
		return this._callstack;
	}

	private _debugSession: SolidityDebugSession;

	constructor(debugSession: SolidityDebugSession) {
		super();
		this._debugSession = debugSession;

		this._sourceMappingDecoder = new SourceMappingDecoder();

		const self = this;

		this._debugSession.event.register('newTraceLoaded', this, function () {
			self._debugSession.traceManager.getLength(function (error, length) {
				if (error) {
					console.log(error)
				} else {
					//self.slider.init(length)
					self.init()
				}
			})
		})

		this._debugSession.codeManager.event.register('changed', this, (code, address, instIndex) => {

			if (self._debugSession.compilationResult) {
				self._debugSession.callTree.sourceLocationTracker.getSourceLocationFromInstructionIndex(address, instIndex, self._debugSession.compilationResult.data.contracts, function (error, rawLocation) {
					if (!error) {
						self._lineColumnPos = self.offsetToLineColumn(rawLocation);
						self._sourceLocation = rawLocation;
						//self.appAPI.currentSourceLocation(lineColumnPos, rawLocation)
					} else {
						//self.appAPI.currentSourceLocation(null)
					}
				})
			}
		})

		this._debugSession.callTree.event.register('callTreeReady', () => {

			if (this._debugSession.callTree.functionCallStack.length) {
				this.jumpTo(this._debugSession.callTree.functionCallStack[0])
			}
		})

	}

	private init() {

		this.changeState(0);

		if (this._debugSession.stopOnEntry)
			this.sendEvent('stopOnEntry');
		else
			this.continue();
	}

	private offsetToLineColumn(rawLocation) {

		if (!this._lineBreakPositionsByContent[this._debugSession.sourceFile]) {
			//let filename = Object.keys(this._debugSession.compilationResult.data.sources)[this._debugSession.sourceFile]
			this._lineBreakPositionsByContent[this._debugSession.sourceFile] = this._sourceMappingDecoder.getLinebreakPositions(this._debugSession.compilationResult.source.sources[this._debugSession.sourceFile].content)
		}

		return this._sourceMappingDecoder.convertOffsetToLineColumn(rawLocation, this._lineBreakPositionsByContent[this._debugSession.sourceFile])
	}

	public jumpTo(step) {
		if (!this._debugSession.traceManager.inRange(step)) {
			return
		}

		this.changeState(step);
	}

	public jumpToNextBreakpoint() {

		let step = this._debugSession.traceManager.findStepOverForward(this.currentStepIndex);

		step = this.resolveToReducedTrace(step, 1);

		//this._debugSession.breakpointManager.hasBreakpointAtLine();
	}

	public stepOverForward(stepEvent?: string) {
		if (!this._debugSession.traceManager.isLoaded()) {
			return
		}

		let step = this._debugSession.traceManager.findStepOverForward(this.currentStepIndex);

		step = this.resolveToReducedTrace(step, 1);

		this.changeState(step);

		this.sendEvent('stopOnStep');
	}



	public resolveToReducedTrace(value, incr) {
		if (this._debugSession.callTree.reducedTrace.length) {
			let nextSource = util.findClosestIndex(value, this._debugSession.callTree.reducedTrace);
			nextSource = nextSource + incr;
			if (nextSource <= 0) {
				nextSource = 0;
			} else if (nextSource > this._debugSession.callTree.reducedTrace.length) {
				nextSource = this._debugSession.callTree.reducedTrace.length - 1;
			}
			return this._debugSession.callTree.reducedTrace[nextSource];
		}
		return value;
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
	 * Run through the file.
	 * If stepEvent is specified only run a single step and emit the stepEvent.
	 */
	private run(reverse = false, stepEvent?: string) {

		let currentLine = this.getCurrentLine(this._debugSession.sourceFile);

		if (reverse) {
			const step = this._debugSession.traceManager.findStepOverBack(this.currentStepIndex)
			this.changeState(step);

			for (let ln = currentLine-1; ln >= 0; ln--) {
				if (this.fireEventsForLine(ln, stepEvent)) {
					this._currentLines.set(this._debugSession.sourceFile, ln);
					return;
				}
			}
			// no more lines: stop at first line
			this._currentLines.set(this._debugSession.sourceFile, 0);
			this.sendEvent('stopOnEntry');
		} else {
			const step = this._debugSession.traceManager.findStepOverForward(this.currentStepIndex);
			this.changeState(step);

			const start = this._lineColumnPos.start;
			const end = this._lineColumnPos.end;

			for (let ln = start.line+1; ln < this._debugSession.breakpointManager.getSourceLinesLength(this._debugSession.sourceFile); ln++) {

				if (this.fireEventsForLine(ln, stepEvent)) {
					this._currentLines.set(this._debugSession.sourceFile, ln);
					return true;
				}
			}


			// no more lines: run to end
			this.emit('end');
		}
	}

	/**
	 * Fire events if line has a breakpoint or the word 'exception' is found.
	 * Returns true is execution needs to stop.
	 */
	private fireEventsForLine(ln: number, stepEvent?: string): boolean {

		const line = this._debugSession.breakpointManager.getSourceLine(this._debugSession.sourceFile, ln).trim();

		if (line.startsWith('pragma')) {
			return false;
		}

		if (line.startsWith('//') ||
				line.startsWith('/*') ||
				line.startsWith('*') ||
				line.startsWith('*/')) {
			return false;
		}

		// if 'log(...)' found in source -> send argument to debug console
		const matches = /log\((.*)\)/.exec(line);
		if (matches && matches.length === 2) {
			this.sendEvent('output', matches[1], this._debugSession.sourceFile, ln, matches.index)
		}

		// if word 'exception' found in source -> throw exception
		if (line.indexOf('exception') >= 0) {
			this.sendEvent('stopOnException');
			return true;
		}

		if (this._debugSession.breakpointManager.hasBreakpointAtLine(this._debugSession.sourceFile, ln)) {
			return true;
		}

		// non-empty line
		if (stepEvent && line.length > 0) {
			this.sendEvent(stepEvent);
			return true;
		}

		// nothing interesting found -> continue
		return false;
	}

	private getCurrentLine(path: string) : number {
		let currentLine = this._currentLines.get(path);

		if (currentLine === undefined) {
			currentLine = 0;
			this._currentLines.set(path, currentLine);
		}

		return currentLine;
	}

		/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public stack(startFrame: number, endFrame: number): any {

		const contract = path.basename(this._debugSession.sourceFile);
		const frames = new Array<any>();
		frames.push({
			index: this._currentStepIndex,
			name: 'constructor',
			file: this._debugSession.sourceFile,
			line: this._lineColumnPos.start.line,
			column: this._lineColumnPos.start.column,
			endLine: this._lineColumnPos.end.line,
			endColumn: this._lineColumnPos.end.column
		});

		return {
			frames: frames,
			count: frames.length
		};

		/*
		const words = this._debugSession.breakpointManager.getSourceLine(sourceFile, currentLine).trim().split(/\s+/);

		const frames = new Array<any>();
		// every word of the current line becomes a stack frame.
		for (let i = startFrame; i < Math.min(endFrame, words.length); i++) {
			const name = words[i];	// use a word of the line as the stackframe name
			frames.push({
				index: i,
				name: `${name}(${i})`,
				file: sourceFile,
				line: currentLine
			});
		};

		return {
			frames: frames,
			count: words.length
		};
		*/
	}

	public changeState(step) {

		const self = this;
		this._currentStepIndex = step

		this._debugSession.codeManager.resolveStep(step, this._debugSession.traceManager.tx);

		this._debugSession.traceManager.getCallStackAt(step, function (error, callstack) {
      if (error) {
        console.log(error)

   //   } else if (self.parent.currentStepIndex === index) {
			} else {
				self._callstack = callstack;
      }
		});

		this._debugSession.traceManager.buildCallPath(step, (error, callsPath) => {
			console.log(callsPath);
		});

		this.emit('stepChanged', [step])
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}