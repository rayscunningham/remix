import * as solc from 'solc';
import { EventManager } from 'remix-lib';

export class SolidityCompiler {

	private _event = new EventManager();
	public get event(): EventManager {
		return this._event;
	}

	public compile(contractName: string, contractCode: string, optimize: boolean): any {

		let output = JSON.parse(solc.compileStandardWrapper(this.compilerInput(contractName, contractCode, optimize)));

		return output;
	}

	public getVersion() {
		return solc.version();
	}

	private compilerInput(contractName: string, contractCode: string, optimize: boolean): string {

		return JSON.stringify({
			language: 'Solidity',
			sources: {
				[contractName +'.sol']: {
					content: contractCode
				}
			},
			settings: {
				optimizer: {
					enabled: optimize,
					runs: 200
				},
				outputSelection: {
					'*': {
						'': [ 'legacyAST' ],
						'*': [ 'abi', 'metadata', 'evm.legacyAssembly', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers', 'evm.gasEstimates' ]
					}
				}
			}
		})
	}
}
