#!/bin/sh
':' //; exec "$(command -v nodejs || command -v node)" "$0" "$@"
"use strict";

/*knitout-3D-visualizer.js
 * Takes a knitout file and turns it into an .txt file. The result should
 * be a series of 3D coordinates with each component delineated by a space and
 * each new coordinate separated by a new line.
 */

//parse command line
if (process.argv.length != 4) {
    console.error("Usage:\nknitout-3D-visualizer.js <in.k> <out.txt>");
    process.exitCode = 1;
    return;
}

//globals
var knitoutFile = process.argv[2];
var textFile = process.argv[3];
const fs = require('fs');
var stream = fs.createWriteStream(textFile);
var activeRow = [];

var boxWidth = 1;
var boxHeight = 1;
var boxDepth = 0.1;
var boxSpacing = boxHeight/2;
var bedDistance = 0.25;


//helper functions

//BedNeedle helps store needles:

function BedNeedle(bed, needle) {
	if (arguments.length == 1 && typeof(arguments[0]) === 'string') {
		let str = arguments[0];
		let m = str.match(/^([fb]s?)(-?\d+)$/);
		if (!m) {
			throw "ERROR: invalid needle specification '" + str + "'.";
		}
		this.bed = m[1];
		this.needle = parseInt(m[2]);
	} else if (arguments.length == 2 && typeof(arguments[0]) === 'string' && typeof(arguments[1]) === 'number') {
		this.bed = arguments[0];
		this.needle = arguments[1];
	} else {
		throw "Don't know how to construct a BedNeedle from the given arguments";
	}
}

BedNeedle.prototype.toString = function() {
	return this.bed + this.needle;
};

BedNeedle.prototype.isFront = function(){
	if (this.bed === 'f' || this.bed === 'fs') return true;
	else if (this.bed === 'b' || this.bed === 'bs') return false;
	else throw "Invalid bed in BedNeedle.";
};

BedNeedle.prototype.isBack = function(){
	if (this.bed === 'f' || this.bed === 'fs') return false;
	else if (this.bed === 'b' || this.bed === 'bs') return true;
	else throw "Invalid bed in BedNeedle.";
};

BedNeedle.prototype.isHook = function(){
	if (this.bed === 'f' || this.bed === 'b') return true;
	else if (this.bed === 'fs' || this.bed === 'bs') return false;
	else throw "Invalid bed in BedNeedle.";
};

BedNeedle.prototype.isSlider = function(){
	if (this.bed === 'fs' || this.bed === 'bs') return true;
	else if (this.bed === 'f' || this.bed === 'b') return false;
	else throw "Invalid bed in BedNeedle.";
};

//Carrier objects store information about each carrier:
function Carrier(name) {
	this.name = name;
	this.last = null; //last stitch -- {needle:, direction:} -- or null if not yet brought in
	this.in = null; //the "in" operation that added this to the active set. (format: {op:"in", cs:["", "", ...]})
}

function format(x, y, z){
    return x+' '+y+' '+z+'\n';
}

function errorHandler(err, data){
    if(err) return console.error(err);
}

/*basic knitout functions
 * each should take:
 *  -start: array of components of the start position
 *  -direction: direction of the current pass,
 *  -bed: the needle bed
 */

function tuck(height, direction, bed, needle){
    let buffer = '';
    let stitch = [];
    let dx = boxWidth/5;
    let dy =  boxHeight/3;
    let dz = boxDepth/2;
    let start = [-needle*boxWidth, height, 0];


    if(direction == '-') dx*= -1;
    else start[0] -= boxWidth;

    if(bed=='b'){
        dz*=-1;
        start[2] = -bedDistance;
    }else{
        start[2] = 0;
    }

    let x = start[0];
    let y = start[1];
    let z = start[2];

    stitch.push([x, y, z]);

    x += 2*dx;
    z -= dz;
    stitch.push([x, y, z]);

    y += dy;
    z += 2*dz;
    stitch.push([x, y, z]);

    x -= dx;
    stitch.push([x, y, z]);

    y += dy;
    stitch.push([x, y, z]);

    x += dx;
    z -= 2*dz;
    stitch.push([x, y, z]);

    x += dx;
    stitch.push([x, y, z]);

    x += dx;
    z += 2*dz;
    stitch.push([x, y, z]);

    y -= dy;
    stitch.push([x, y, z]);

    x -= dx;
    stitch.push([x, y, z]);

    y -= dy;
    z -= 2*dz;
    stitch.push([x, y, z]);

    x += 2*dx;
    z += dz;
    stitch.push([x, y, z]);

    activeRow[needle] = (stitch);

}

function knit(height, direction, bed, needle){
    tuck(height, direction, bed, needle);
}

function xfer(fromSide, fromNeedle, toSide, toNeedle){
    let stitch = activeRow[fromNeedle];

    let height = stitch[0][1];
    let dx = (stitch[1][0]-stitch[0][0])/2;
    let dy =  boxHeight/3;
    let dz = boxDepth/2;
    let dir = dx>0 ? '+' : '-';
    let start = [-toNeedle*boxWidth, height, 0];


    if(dir == '-') dx*= -1;
    else start[0] -= boxWidth;

    if(toSide == 'b'){
        dz*=-1;
        start[2] = -bedDistance;
    }else{
        start[2] = 0;
    }

    let x = start[0];
    let y = start[1];
    let z = start[2];

    x += 2*dx;
    z -= dz;

    y += dy;
    z += 2*dz;

    x -= dx;
    stitch [3] = [x, y, z];

    y += dy;
    stitch [4] = [x, y, z];

    x += dx;
    z -= 2*dz;
    stitch [5] = [x, y, z];

    x += dx;
    stitch [6] = [x, y, z];

    x += dx;
    z += 2*dz;
    stitch [7] = [x, y, z];

    y -= dy;
    stitch [8] = [x, y, z];

    x -= dx;

    y -= dy;
    z -= 2*dz;

    x += 2*dx;
    z += dz;



}

function newRow(height, currDir){
    var buffer = '';
    for(let i = 0; i<activeRow.length; i++){
        if(currDir == '-')
            var stitch = activeRow[i];
        else
            var stitch = activeRow[activeRow.length-1-i];
        for(let j = 0; j<stitch.length; j++){
            let point = stitch[j];
            buffer += format(point[0], point[1], point[2]);
        }
    }
    stream.write(buffer);
    activeRow = [];

    height+=boxSpacing;
    return height;
}

//just for testing
function tests(){
    let height = 0;
    let bed = 'f';
    let direction = '-';

    for(let col = 0; col<10; col++){
        if(col%2==0)
            bed = 'f';
        else
            bed = 'b';
        tuck(height, '-', bed, col);
    }
    height = newRow(height, '-');

    for(let col = 9; col>=0; col--){
        if(col%2==0)
            bed = 'f';
        else
            bed = 'b';
        knit(height, '+', bed, col);
    }

    xfer ('f', 0, 'b', 0);
    xfer ('b', 0, 'f', 1);
    height = newRow(height, '+');
}

//main parser
//heavily based on the knitout-dat.js parsing code in knitout-backend
function main(){
    let lines = fs.readFileSync(knitoutFile, 'utf8').split('\n');
    (function checkVersion(){
        let m = lines[0].match(/^;!knitout-(\d+)$/);
        if(!m)
            throw 'File does not start with knitout magic string';
        if(parseInt(m[1])>2)
            console.warn('WARNING: File is version '+m[1]
                    +', but this code only knows about versions up to 2.');
    })();

    let carriers = {}; //each are a name=>object map
    let racking = 0.0; //starts centered
    let stitch = 5; //machine-specific stitch number

    lines.forEach(function(line, lineIdx){
        let i = line.indexOf(';');
        if(i>=0) line = line.substr(0,i);
        let tokens = line.split(/[ ]+/);

        if(tokens.length>0 && tokens[0] ==='') tokens.shift();
        if(tokens.length>0 && tokens[tokens.length-1] === '') tokens.pop();

        if(tokens.length == 0) return;

        let op = tokens.shift();
        let args = tokens;

        if(op === 'tuck'|| op === 'knit'){
            let d = args.shift();
            let n = new BedNeedle(args.shift());
            let cs = args;
            //handleIn(cs, info);
            //merge(new Pass(info));
            //setLast(cs, d, n);
        }else if(op === 'xfer'){
            console.log(args);
        }
    });

}

//tests();
main();
