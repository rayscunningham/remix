'use strict'
import { SourceMappingDecoder } from 'remix-lib';

export class OffsetToColumnConverter {

	private _lineBreakPositionsByContent: any = {};
	private _sourceMappingDecoder: SourceMappingDecoder = new SourceMappingDecoder();

/*
	constructor(compilerEvent) {
		this._lineBreakPositionsByContent = {}
		this._sourceMappingDecoder = new SourceMappingDecoder()
		var self = this
		compilerEvent.register('compilationFinished', function (success, data, source) {
			self.clear()
		})
	}
*/
  constructor() {

	}

	public offsetToLineColumn(rawLocation, file, compilationResult) {
		if (!this._lineBreakPositionsByContent[file]) {
			var filename = Object.keys(compilationResult.data.sources)[file]
			this._lineBreakPositionsByContent[file] = this._sourceMappingDecoder.getLinebreakPositions(compilationResult.source.sources[filename].content)
		}
		return this._sourceMappingDecoder.convertOffsetToLineColumn(rawLocation, this._lineBreakPositionsByContent[file])
	}

	public clear() {
  	this._lineBreakPositionsByContent = {}
	}
}