import * as solc from 'solc';
import * as solcABI from 'solc/abi';
//import { EventManager } from 'remix-lib';
import { EventEmitter } from 'events';
import { Compiler, CompilerInput } from 'remix-solidity';
import { SourceMappingDecoder } from 'remix-lib';
import * as CompilerWorker from 'remix-solidity/src/compiler/compiler-worker';
import * as txHelper from 'remix-solidity/src/compiler/txHelper';
import * as path from 'path';
import * as fs from 'fs';

export enum SolidityCompilerType {
	DEFAULT,
	LOCAL,
	REMOTE
}

export interface CompilationResult {
	data: any;
	source: CompilationSource;
}

export interface CompilationSource {
	sources: any;
	target: string;
}

export class SolidityCompiler extends EventEmitter {

//private _rootPath: string;

	private compiler: any;
	private compilerType: SolidityCompilerType = SolidityCompilerType.DEFAULT;

	private optimize: boolean;

	//public currentCompilerSetting: string;

	constructor(compilerType: SolidityCompilerType, args?: any[], optimize?: boolean) {
		super();
		this.compilerType = compilerType;
		this.compiler = require('solc');
	}

	public compileAsynch(compilationSource: CompilationSource): Promise<CompilationResult> {
		return new Promise<CompilationResult>( (resolve, reject) => {

			try {
				let compilationResult = this.compile(compilationSource);
				resolve(compilationResult);
			} catch(e) {
				reject(e);
			}
		});
	}

	public compile(compilationSource: CompilationSource): CompilationResult {

			const input = CompilerInput(compilationSource.sources, {optimize: this.optimize, target: compilationSource.target});
			//let result = this.compiler.compileStandardWrapper(input, missingInputsCallback);

			let result = JSON.parse(this.compiler.compileStandardWrapper(input));

			let compilationResult: CompilationResult = {
				data: result,
				source: compilationSource
			}

			//this.emit('compilationFinished', compilationResult);

			return compilationResult;
	}
/*
	private compilationFinished (data, missingInputs, source) {
    var noFatalErrors = true // ie warnings are ok

    function isValidError (error) {
      // The deferred import is not a real error
      // FIXME: maybe have a better check?
      if (/Deferred import/.exec(error.message)) {
        return false
      }

      return error.severity !== 'warning'
    }

    if (data['error'] !== undefined) {
      // Ignore warnings (and the 'Deferred import' error as those are generated by us as a workaround
      if (isValidError(data['error'])) {
        noFatalErrors = false
      }
    }
    if (data['errors'] !== undefined) {
      data['errors'].forEach(function (err) {
        // Ignore warnings and the 'Deferred import' error as those are generated by us as a workaround
        if (isValidError(err)) {
          noFatalErrors = false
        }
      })
    }

    if (!noFatalErrors) {
      // There are fatal errors - abort here
      this.lastCompilationResult = null
      //self.event.trigger('compilationFinished', [false, data, source])
    } else if (missingInputs !== undefined && missingInputs.length > 0) {
      // try compiling again with the new set of inputs
      //internalCompile(source.sources, source.target, missingInputs)
    } else {
      data = this.updateInterface(data)

      this.lastCompilationResult = {
        data: data,
        source: source
      }
      //self.event.trigger('compilationFinished', [true, data, source])
    }
	}
	*/

  private truncateVersion (version) {
    var tmp = /^(\d+.\d+.\d+)/.exec(version)
    if (tmp) {
      return tmp[1]
    }
    return version
  }

  private updateInterface (data) {
    txHelper.visitContracts(data.contracts, (contract) => {
      data.contracts[contract.file][contract.name].abi = solcABI.update(this.truncateVersion(this.getVersion()), contract.object.abi)
    })
    return data
  }

 /*
	public getDefaultInstallation() {
		return path.join(this._rootPath, 'node_modules', 'solc', 'soljson.js');
	}
	*/

	public getVersion(): string {
		return this.compiler.version();
	}
/*
	public offsetToLineColumn(rawLocation, file, compilationResult) {
		if (!this.lineBreakPositionsByContent[file]) {
			var filename = Object.keys(compilationResult.data.sources)[file]
			this.lineBreakPositionsByContent[file] = this.sourceMappingDecoder.getLinebreakPositions(compilationResult.source.sources[filename].content)
		}
		return this.sourceMappingDecoder.convertOffsetToLineColumn(rawLocation, this.lineBreakPositionsByContent[file])
	}
*/s

}
