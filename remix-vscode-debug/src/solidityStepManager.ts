import { EventEmitter } from 'events';
import { trace } from 'remix-core';
import { SolidityBreakpointManager } from './solidityBreakpointManager';

export class SolidityStepManager extends EventEmitter {

	private _currentStepIndex: number = -1;
	public get currentStepIndex() {
		return this._currentStepIndex;
	}

	private _currentLine: number = -1;
	public get currentLine() {
		return this._currentLine;
	}

	private _breakpointManager: SolidityBreakpointManager;

	private _traceManager: trace.TraceManager;
	public get traceManager() {
		return this._traceManager;
	}

	constructor(breakpointManager: SolidityBreakpointManager, traceManager: trace.TraceManager) {
		super();
		this._breakpointManager = breakpointManager;
		this._traceManager = traceManager;
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
			for (let ln = this._currentLine+1; ln < this._breakpointManager.getSourceLinesLength(); ln++) {

				//this._codeManager.resolveStep(index, this._transaction);

				if (this.fireEventsForLine(ln, stepEvent)) {
					this._currentLine = ln;
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

		const line = this._breakpointManager.getSourceLine(ln).trim();

		if (line.startsWith('pragma')) {
			return false;
		}

		// if 'log(...)' found in source -> send argument to debug console
		const matches = /log\((.*)\)/.exec(line);
		if (matches && matches.length === 2) {
			this.sendEvent('output', matches[1], this._breakpointManager.sourceFile, ln, matches.index)
		}

		// if word 'exception' found in source -> throw exception
		if (line.indexOf('exception') >= 0) {
			this.sendEvent('stopOnException');
			return true;
		}

		if (this._breakpointManager.hasBreakpointAtLine(ln))
			return true;

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

	private changeState(step) {
		this._currentStepIndex = step
		this.emit('stepChanged', [step])
	}

}