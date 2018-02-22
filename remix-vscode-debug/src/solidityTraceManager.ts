import { trace } from 'remix-core';
import { global } from 'remix-lib';

export class SolidityTraceManager extends trace.TraceManager {

	constructor() {
		super();
	}

	public resolveTrace(tx, callback) {

		console.log("Resolve Trace!!!");

		super.tx = tx
		super.init()
		if (!global.web3) callback('web3 not loaded', false)
		super.isLoading = true

		let self = super.this;

		this.getTrace(tx.hash, function (error, result) {
			if (error) {
				console.log(error)
				self.isLoading = false
				callback(error, false)
			} else {
				if (result.logs.length > 0) {
					self.trace = result.logs
					self.traceAnalyser.analyse(result.logs, tx, function (error, result) {
						if (error) {
							self.isLoading = false
							console.log(error)
							callback(error, false)
						} else {
							self.isLoading = false
							callback(null, true)
						}
					})
				} else {
					var mes = tx.hash + ' is not a contract invokation or contract creation.'
					console.log(mes)
					self.isLoading = false
					callback(mes, false)
				}
			}
		})
	}

	private getTrace(txHash, callback) {

		global.web3.currentProvider.sendAsync({
			method: "debug_traceTransaction",
			params: [txHash,
				{ disableStorage: true,
					disableMemory: false,
					disableStack: false,
					fullStorage: false
				}],
			jsonrpc: "2.0",
			id: "2"
			},
			callback);
	}
}
