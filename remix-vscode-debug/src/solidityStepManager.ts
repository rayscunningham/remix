import { EventEmitter } from 'events';
import * as path from 'path';
import { SolidityDebugSession } from './solidityDebug';
import { SourceMappingDecoder, helpers, util } from 'remix-lib';
import { storage } from 'remix-core';
import { stateDecoder } from 'remix-solidity';

export class SolidityStepManager extends EventEmitter {

	private _currentStepIndex: number = -1;
	public get currentStepIndex() {
		return this._currentStepIndex;
	}

	private _previousLine: number;

	private _lineColumnPos: any;
	public get lineColumnPos() {
		return this._lineColumnPos;
	}

	private _sourceLocation: any;
	public get sourceLocation() {
		return this._sourceLocation;
	}

	private _stateVariablesByAddresses: any = [];
	private _storageResolver: storage.StorageResolver;

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
		this._storageResolver = new storage.StorageResolver();

		const self = this;

		this._debugSession.event.register('newTraceLoaded', this, function () {
			self._debugSession.traceManager.getLength(function (error, length) {
				if (error) {
					console.log(error)
				} else {
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
			// we step once
			this.sendEvent('stopOnEntry');
		else
			// we just start to run until we hit a breakpoint or an exception
			this.jumpNextBreakpoint(true);

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

	  /**
    * start looking for the next breakpoint
    * @param {Bool} defaultToLimit - if true jump to the end of the trace if no more breakpoint found
    *
    */
	public async jumpNextBreakpoint (defaultToLimit) {
    this.jump(1, defaultToLimit)
  }

  /**
    * start looking for the previous breakpoint
    * @param {Bool} defaultToLimit - if true jump to the start of the trace if no more breakpoint found
    *
    */
  public async jumpPreviousBreakpoint (defaultToLimit) {
    this.jump(-1, defaultToLimit)
  }

	/**
    * start looking for the previous or next breakpoint
    * @param {Int} direction - 1 or -1 direction of the search
    * @param {Bool} defaultToLimit - if true jump to the limit (end if direction is 1, beginning if direction is -1) of the trace if no more breakpoint found
    *
    */
	private async jump(direction, defaultToLimit) {

    let sourceLocation;
    let previousSourceLocation;
    let currentStep = this._currentStepIndex + direction;
		let lineHadBreakpoint = false;

    while (currentStep > 0 && currentStep < this._debugSession.traceManager.trace.length) {
      try {
        previousSourceLocation = sourceLocation
        sourceLocation = await this._debugSession.callTree.extractSourceLocation(currentStep)
      } catch (e) {
        console.log('cannot jump to breakpoint ' + e)
        return;
      }
      let lineColumn = this.offsetToLineColumn(sourceLocation)
      if (this._previousLine !== lineColumn.start.line) {
        if (direction === -1 && lineHadBreakpoint) { // TODO : improve this when we will build the correct structure before hand
          lineHadBreakpoint = false
          if (this.hitLine(currentStep + 1, previousSourceLocation, sourceLocation, this)) {
            return;
          }
        }
        this._previousLine = lineColumn.start.line
        if (this._debugSession.breakpointManager.hasBreakpointAtLine(this._debugSession.sourceFile, lineColumn.start.line)) {
          lineHadBreakpoint = true
          if (direction === 1) {
            if (this.hitLine(currentStep, sourceLocation, previousSourceLocation, this)) {
              return;
            }
          }
        }
      }
      currentStep += direction
		}

		if (defaultToLimit) {
      if (direction === -1) {
        this.jumpTo(0)
      } else if (direction === 1) {
        this.jumpTo(this._debugSession.traceManager.trace.length - 1)
      }
    }
	}

	private depthChange (step, trace) {
		return trace[step].depth !== trace[step - 1].depth
	}

	private hitLine (currentStep, sourceLocation, previousSourceLocation, self) {
		// isJumpDestInstruction -> returning from a internal function call
		// depthChange -> returning from an external call
		// sourceLocation.start <= previousSourceLocation.start && ... -> previous src is contained in the current one
		if ((helpers.trace.isJumpDestInstruction(this._debugSession.traceManager.trace[currentStep]) && previousSourceLocation.jump === 'o') ||
			this.depthChange(currentStep, this._debugSession.traceManager.trace) ||
			(sourceLocation.start <= previousSourceLocation.start &&
			sourceLocation.start + sourceLocation.length >= previousSourceLocation.start + previousSourceLocation.length)) {
			return false
		} else {
			this.jumpTo(currentStep)
			//self.event.trigger('breakpointHit', [sourceLocation])
			this.sendEvent('stopOnBreakpoint');
			return true
		}
	}

	public stepOverForward() {
		if (!this._debugSession.traceManager.isLoaded()) {
			return
		}

		let step = this._debugSession.traceManager.findStepOverForward(this.currentStepIndex);

		step = this.resolveToReducedTrace(step, 1);

		this.changeState(step);

		this.sendEvent('stopOnStep');
	}

	public stepOverBack() {
		if (!this._debugSession.traceManager.isLoaded()) {
			return
		}

		let step = this._debugSession.traceManager.findStepOverBack(this.currentStepIndex);

		step = this.resolveToReducedTrace(step, -1);

		this.changeState(step);

		this.sendEvent('stopOnStep');
	}

	public stepIntoForward() {
		if (!this._debugSession.traceManager.isLoaded()) {
			return
		}
		let step = this.currentStepIndex;

		step = this.resolveToReducedTrace(step, 1);

		if (!this._debugSession.traceManager.inRange(step)) {
			return
		}

		this.changeState(step);
	}

	public stepIntoBack() {
		if (!this._debugSession.traceManager.isLoaded()) {
			return
		}
		let step = this.currentStepIndex

			step = this.resolveToReducedTrace(step, -1);

		if (!this._debugSession.traceManager.inRange(step)) {
			return
		}

		this.changeState(step);
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
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public stack(startFrame: number, endFrame: number): any {

		//const contract = path.basename(this._debugSession.sourceFile);

		const frames = new Array<any>();

		frames.push({
			index: this._currentStepIndex,
			name: this._callstack,
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

		this._debugSession.traceManager.getCurrentCalledAddressAt(step, (error, address) => {
			if (error) {
				console.log(error)
			} else {
				if (this._stateVariablesByAddresses[address]) {
						this.extractStateVariables(self, this._stateVariablesByAddresses[address], address)
				} else {
					this._debugSession.solidityProxy.extractStateVariablesAt(step, (error, stateVars) => {
						if (error) {
							console.log(error)
						} else {
							this._stateVariablesByAddresses[address] = stateVars
							this.extractStateVariables(self, stateVars, address)
						}
					});
				}
			}

		});

		this.emit('stepChanged', [step])

		/*
		if (step === (this._debugSession.traceManager.trace.length - 1))
			this.emit('end');
		*/
	}

	private extractStateVariables(self, stateVars, address) {
		let storageViewer = new storage.StorageViewer({
			stepIndex: this._currentStepIndex,
			tx: this._debugSession.tx,
			address: address
		},
		this._storageResolver,
		this._debugSession.traceManager);

		stateDecoder.decodeState(stateVars, storageViewer).then((result) => {
			console.log(result);
			//self.basicPanel.setMessage('')
			if (!result.error) {
				//self.basicPanel.update(result)
			} else {
				//self.basicPanel.setMessage(result.error)
			}
		})
	}


	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}