import { EventEmitter } from 'events';
import { SolidityDebugSession } from './solidityDebug';

export class SolidityStepManager extends EventEmitter {

	private _currentStepIndex: number = -1;
	public get currentStepIndex() {
		return this._currentStepIndex;
	}

	private _currentLines = new Map<string, number>();

	private _debugSession: SolidityDebugSession;

	constructor(debugSession: SolidityDebugSession) {
		super();
		this._debugSession = debugSession;
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

			for (let ln = currentLine+1; ln < this._debugSession.breakpointManager.getSourceLinesLength(this._debugSession.sourceFile); ln++) {


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
		const sourceFile = this._debugSession.sourceFile;
		const currentLine = this.getCurrentLine(sourceFile);

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
		}
		return {
			frames: frames,
			count: words.length
		};
	}

	public changeState(step) {
		this._currentStepIndex = step
		this._debugSession.codeManager.resolveStep(step, this._debugSession.traceManager.tx);

		this.emit('stepChanged', [step])
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}