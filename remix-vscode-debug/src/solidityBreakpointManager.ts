import { EventEmitter } from 'events';
import { SolidityDebugSession } from './solidityDebug';
import * as fs from 'fs';

export interface SolidityBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

export class SolidityBreakpointManager extends EventEmitter {

	private _breakPoints = new Map<string, SolidityBreakpoint[]>();
	private _sourceLines = new Map<string, string[]>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId = 1;

	private _debugSession: SolidityDebugSession;

	constructor(debugSession: SolidityDebugSession) {
		super();
		this._debugSession = debugSession;
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
	public clearBreakpoints(path: string) : void {
		this._breakPoints.delete(path);
	}

	public hasBreakpointAtLine(path: string, line: number) : boolean {

		// is there a breakpoint?
		const breakpoints = this._breakPoints.get(path);
		if (breakpoints) {
			const bps = breakpoints.filter(bp => bp.line === line);
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

		return false;
	}

	private verifyBreakpoints(path: string) : void {
		let bps = this._breakPoints.get(path);
		if (bps) {

			//this._debugSession.loadSource(path);

			bps.forEach(bp => {
				const sourceLines = this.getSourceLines(path);

				if (!bp.verified && bp.line < sourceLines.length) {
					const srcLine = sourceLines[bp.line].trim();

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

	public getSourceLine(path: string, line: number) : string {
		return this.getSourceLines(path)[line];
	}

	public getSourceLinesLength(path: string) : number {
		const length = this.getSourceLines(path).length;

		return length;
	}

	private getSourceLines(path: string): string[] {
		let sourceLines = this._sourceLines.get(path);
		if (sourceLines === undefined) {
			sourceLines = fs.readFileSync(path).toString().split('\n');
		}

		return sourceLines;
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}