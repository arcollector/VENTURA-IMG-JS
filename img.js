/////////////////////////////
// UTILS
/////////////////////////////

var loadFile = function( filenameURL, callback ) {
	var xhr = new XMLHttpRequest();
	xhr.open( 'GET', filenameURL );
	xhr.responseType = 'arraybuffer';
	xhr.onload = function( e ) {
		var data = this.response;
		if( data ) {
			callback( new Uint8Array( data ) );
		} else {
			console.error( 'corrupted fail' );
		}
	};
	xhr.onerror = function( e ) {
		console.error( 'fail to load the file' );
	};
	xhr.send();
};

var pixels2Bytes = function( px ) {
	return parseInt((px+7)/8);
};

var big2Little = function( arrayBuffer, index ) {
	return (arrayBuffer[index]<<8) | arrayBuffer[index+1];
};

var downloadFile = function( arrayBuffer, filename ) {
	filename = filename.toString();
	// create the download link
	var blob = new Blob( [ arrayBuffer ], { type: 'application/octet-binary' } );
	var a = document.createElement( 'a' );
	a.setAttribute( 'download', filename + '.img' );
	a.setAttribute( 'href', URL.createObjectURL( blob ) );
	a.style.display = 'none';
	document.body.appendChild( a );
	// show download window
	a.click();
};

/////////////////////////////
// CODE
/////////////////////////////
var DEBUG = false;

/////////////////////////////
// DECODING
/////////////////////////////

const HEADER_SIZE_IN_WORDS = 3;
const IMAGE_PLANES = 4;
const PATTERN_LENGTH = 6;
const PIXEL_WIDTH_SIZE_MICRONS = 8;
const PIXEL_HEIGHT_SIZE_MICRONS = 10;
const PIXEL_WIDTH = 12;
const PIXEL_HEIGHT = 14;

var decodeHeader = function( arrayBuffer, header ) {
	if( arrayBuffer.length < 18 ) {
		console.error( 'not a IMG file' );
		return false;
	}

	if( arrayBuffer[0] !== 0 && arrayBuffer[1] !== 1 ) {
		console.error( 'not a IMG file' );
		return false;
	}
	
	header.wordsCount = arrayBuffer[HEADER_SIZE_IN_WORDS];
	header.bytesCount = header.wordsCount << 1;
	console.log( 'header size in words is', header.wordsCount, 'and in bytes is', header.bytesCount );
	
	header.imagePlanes = big2Little( arrayBuffer, IMAGE_PLANES );
	console.log( 'image color depth is', header.imagePlanes );
	if( header.imagePlanes !== 1 ) { // check for monochrome-ness
		console.error( 'img file is not monochrome' );
		return false;
	}

	header.patternLength = big2Little( arrayBuffer, PATTERN_LENGTH );
	console.log( 'pattern length is', header.patternLength );
	
	header.micronsWidth = big2Little( arrayBuffer, PIXEL_WIDTH_SIZE_MICRONS );
	header.micronsHeight = big2Little( arrayBuffer, PIXEL_HEIGHT_SIZE_MICRONS );
	console.log( 'pixel size in microns for width and for height respectively', header.micronsWidth, header.micronsHeight );
	
	header.pixelWidth = big2Little( arrayBuffer, PIXEL_WIDTH );
	header.pixelHeight = big2Little( arrayBuffer, PIXEL_HEIGHT );
	console.log( 'img file dimensions (in pixels) are (width*height)', header.pixelWidth, header.pixelHeight );
	header.widthInBytes = pixels2Bytes( header.pixelWidth );
	console.log( 'width in bytes is', header.widthInBytes );
	
	return true;
};

var decodeImage = function( arrayBuffer, header ) {
	
	var arrayBufferIndex = header.bytesCount;
	
	var bitmap = new Uint8Array( header.widthInBytes*header.pixelHeight );
	var bitmapIndex = 0;

	var scanLine = new Uint8Array( header.widthInBytes );

	for( var i = 0; i < header.pixelHeight; ) {
		var repCount = 1;
		// loop 'tl the line's all decoded
		if( DEBUG ) { var lineOriginal = []; }
		for( var scanLineIndex = 0; scanLineIndex < header.widthInBytes; ) {
			var ch = arrayBuffer[arrayBufferIndex++];
			if( ch === 0 ) {
				// it's a repetition count or a pattern
				ch = arrayBuffer[arrayBufferIndex++];
				if( ch === 0 ) {
					DEBUG && lineOriginal.push( 0 ) && lineOriginal.push( 0 ) && lineOriginal.push( arrayBuffer[arrayBufferIndex] );
					// it's a repetition count change
					arrayBufferIndex++; // ignore this byte
					repCount = arrayBuffer[arrayBufferIndex++];
					DEBUG && lineOriginal.push( repCount );
				} else {
					DEBUG && lineOriginal.push( 0 ) && lineOriginal.push( ch );
					var k = scanLineIndex;
					var j = header.patternLength;
					while( j-- ) { // obtain the pattern
						DEBUG && lineOriginal.push( arrayBuffer[arrayBufferIndex] );
						scanLine[scanLineIndex++] = ~arrayBuffer[arrayBufferIndex++];
					}
					// repeat the pattern by count - 1, because above
					for( var count = ch - 1, offset = 0; count; count--, offset = offset === header.patternLength ? 0 : offset + 1 ) {
						scanLine[scanLineIndex++] = scanLine[k+offset];
					}
				}
			} else if( ch === 0x80 ) {
				// it's a string of bytes
				var count = arrayBuffer[arrayBufferIndex++];
				DEBUG && lineOriginal.push( 0x80 ) && lineOriginal.push( count );
				while( count-- ) {
					DEBUG && lineOriginal.push( arrayBuffer[arrayBufferIndex] );
					scanLine[scanLineIndex++] = ~arrayBuffer[arrayBufferIndex++];
				}
			} else if( ch & 0x80 ) {
				// it's a solid white run
				DEBUG && lineOriginal.push( ch );
				var count = ch & 0x7f;
				while( count-- ) {
					scanLine[scanLineIndex++] = ~0xff;
				}
			} else {
				// its a solid black run
				DEBUG && lineOriginal.push( ch );
				var count = ch & 0x7f;
				while( count-- ) {
					scanLine[scanLineIndex++] = ~0x00;
				}
			}
		}
		DEBUG && console.log( i, lineOriginal );
		while( repCount-- ) {
			for( var j = 0; j < header.widthInBytes; j++ ) {
				bitmap[bitmapIndex++] = scanLine[j];
			}
			i++;
		}
	}
	console.log( 'compressed image is', arrayBufferIndex-header.bytesCount, 'bytes long' );
	
	return bitmap;
};

var displayBitmap = function( bitmap, width, height ) {
	var $canvas = document.querySelector( '.picture' );
	$canvas.width = width;
	$canvas.height = height;
	var context = $canvas.getContext( '2d' );
	var image = context.createImageData( width, height );
	var widthInBytes = pixels2Bytes( width );
	var lastPixelCount = 8 - (widthInBytes*8 - width);
	var widthInBytesMinus1 = widthInBytes - 1;
	for( var i = 0, j = 0, curwidthInBytes = 0; i < bitmap.length; i++ ) {
		var colorsBit = bitmap[i];
		var colors = [
			(colorsBit & 0x80) >> 7, 
			(colorsBit & 0x40) >> 6, 
			(colorsBit & 0x20) >> 5, 
			(colorsBit & 0x10) >> 4, 
			(colorsBit & 0x08) >> 3, 
			(colorsBit & 0x04) >> 2, 
			(colorsBit & 0x02) >> 1, 
			colorsBit & 0x01 
		];
		var pixelsCount = curwidthInBytes === widthInBytesMinus1 ? lastPixelCount : 8; // am i in last byte ??
		curwidthInBytes = curwidthInBytes ===  widthInBytesMinus1 ? 0 : curwidthInBytes + 1; // increment wisely
		for( var k = 0; k < pixelsCount; k++ ) {
			var color = colors[k]*255;
			image.data[j++] = color;
			image.data[j++] = color;
			image.data[j++] = color;
			image.data[j++] = 255;
		}
	}
	context.putImageData( image, 0, 0 );
};

/////////////////////////////
// ENCONDING
/////////////////////////////

var createHeader = function( width, height ) {
	// NOTE: IMG is big endian
	
	var header = new Uint8Array( [
		0x00,0x01, // IMG signature
		0x00,0x08, // header size in words
		0x00,0x01, // monochrome image
		0x00,0x01, // pattern length
		0x00,0x55, // pixel size in microns for width
		0x00,0x55, // pixel size in microns for height
		0x00,0x00, // pixel width
		0x00,0x00, // pixel height
	] );
	
	header[12] = (width >> 8) & 0xff;
	header[13] = width & 0xff;
	header[14] = (height >> 8) & 0xff;
	header[15] = height & 0xff;
	
	return header;
};

var encodeImage = function( bitmap, info ) {

	var compress = new Uint8Array( info.widthInBytes*info.pixelHeight );
	var compressIndex = 0;
	
	var bitmapIndex = 0;
	
	var buffer = new Uint8Array( info.widthInBytes );
	
	for( var i = 0; i < info.pixelHeight; i++ ) {
		if( DEBUG ) { var lineEncoded = []; }
		var bufferIndex = 0;
		for( var j = 0; j < info.widthInBytes; ) {
			// begin by counting bytes which are the same. we must check to
			// see that we don't write too long a line, as the start of the next line
			// might have the same bit pattern as the end of this one
			var sameBytes = 0;
			while( j < (info.widthInBytes-1) && 
				sameBytes < 126 && 
				bitmap[bitmapIndex+j] === bitmap[bitmapIndex+j+1]
			) {
				j++;
				sameBytes++;
			}

			// if there's a run or the output buffer is full, we must write the data to the file
			if( sameBytes > 0 ) {
				// if bufferIndex is true, there's a string in the buffer...
				// just a field key and data
				if( bufferIndex ) {
					// strings are written as literal data... just a field key and data
					compress[compressIndex++] = 0x80;
					compress[compressIndex++] = bufferIndex;
					DEBUG && lineEncoded.push( 0x80 ) && lineEncoded.push( bufferIndex );
					for( var k = 0; k < bufferIndex; k++ ) {
						DEBUG && lineEncoded.push( buffer[k] );
						compress[compressIndex++] = buffer[k];
					}
					bufferIndex = 0;
				}
				// IMG has various ways to compress strings, with empahsis on solid
				// black or white runs
				if( bitmap[bitmapIndex+j] === 0x00 ) { // 0x00 is white in IMG schema
					compress[compressIndex++] = 0x80 + sameBytes + 1;
					DEBUG && lineEncoded.push( 0x80 + sameBytes + 1 );
					
				} else if( bitmap[bitmapIndex+j] === 0xff ) { // 0xff is black in IMG schema
					compress[compressIndex++] = sameBytes + 1;
					DEBUG && lineEncoded.push( sameBytes + 1 );
					
				} else {
					// runs of something other than black or white must be written as
					// three byte fields
					compress[compressIndex++] = 0x00;
					compress[compressIndex++] = sameBytes + 1;
					compress[compressIndex++] = ~bitmap[bitmapIndex+j];
					DEBUG && lineEncoded.push( 0x00 ) && lineEncoded.push( sameBytes + 1 ) && lineEncoded.push( compress[compressIndex-1] );
				}
				j++;
				
			// if there's no run, add the byte to the current string and loop again to see if the
			// next byte is the start of a run
			} else {
				buffer[bufferIndex++] = ~bitmap[bitmapIndex+j];
				j++;
			}
		}
		// we have now dealt with all the source data in the line.
		// there may be a string still waiting in the buffer, however,
		// so we must check bufferIndex one last time
		if( bufferIndex ) {
			compress[compressIndex++] = 0x80;
			compress[compressIndex++] = bufferIndex;
			DEBUG && lineEncoded.push( 0x80 ) && lineEncoded.push( bufferIndex );
			for( var k = 0; k < bufferIndex; k++ ) {
				DEBUG && lineEncoded.push( buffer[k] );
				compress[compressIndex++] = buffer[k];
			}
		}
		DEBUG && console.log( i, lineEncoded );
		
		bitmapIndex += info.widthInBytes; // next scanline
	}
	
	console.log( 'bitmap image has been compressed to', compressIndex, 'bytes long' );
	return compress.subarray( 0, compressIndex );
};

var createFile = function( header, compress ) {
	var arrayBuffer = new Uint8Array( header.length + compress.length );
	arrayBuffer.set( header, 0 );
	arrayBuffer.set( compress, header.length );
	return arrayBuffer;
};

/////////////////////////////
// TEST
/////////////////////////////
//DEBUG = true;
var filenameURL = 'OE_Z.IMG';
var filenameURL = 'BUSINESS.IMG';
var filenameURL = 'FC1.HTML';
loadFile( filenameURL, function( arrayBuffer ) {
	console.log( 'file size is', arrayBuffer.length, 'bytes long' );
	var formattedHeader = {};
	if( !decodeHeader( arrayBuffer, formattedHeader ) ) {
		return;
	}
	//console.log( formattedHeader );
	var bitmap = decodeImage( arrayBuffer, formattedHeader );
	displayBitmap( bitmap, formattedHeader.pixelWidth, formattedHeader.pixelHeight );
	
	var compress = encodeImage( bitmap, { widthInBytes: formattedHeader.widthInBytes, pixelHeight: formattedHeader.pixelHeight } );
	var header = createHeader( formattedHeader.pixelWidth, formattedHeader.pixelHeight );
	var file = createFile( header, compress );
	downloadFile( file, +new Date() );
	/*var formattedHeader = {};
	decodeHeader( arrayBuffer, formattedHeader );
	var bitmap2 = decodeImage( file, formattedHeader );
	displayBitmap( bitmap2, formattedHeader.pixelWidth, formattedHeader.pixelHeight );*/
} );