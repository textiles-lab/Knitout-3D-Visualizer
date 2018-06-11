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
let knitoutfile = process.argv[2];
let textFile = process.argv[3];
const fs = require('fs');
var stream = fs.createWriteStream(textFile);
var activeRow = [];

var boxWidth = 1;
var boxHeight = 1;
var boxDepth = 0.1;
var boxSpacing = boxHeight/2;
var bedDistance = 0.25;


//helper functions
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

function tuck(start, direction, bed){
    var buffer = '';
    var dx  = boxWidth/6;
    var dy =  boxHeight/3;
    var dz = boxDepth/2;
    if(direction == '-') dx*= -1;
    if(bed=='b'){
        dz*=-1;
        start[2] = -bedDistance;
    }else{
        start[2] = 0;
    }

    var x = start[0];
    var y = start[1];
    var z = start[2];

    x += dx;
    buffer += format( x, y, z);

    x += 2*dx;
    z -= dz;
    buffer += format( x, y, z);

    y += dy;
    z += 2*dz;
    buffer += format( x, y ,z);

    x -= dx;
    buffer += format( x, y, z);

    y += dy;
    buffer += format( x, y, z);

    x += dx;
    z -= 2*dz;
    buffer += format( x, y, z);

    x += dx;
    buffer += format( x, y, z);

    x += dx;
    z += 2*dz;
    buffer += format( x, y, z);

    y -= dy;
    buffer += format( x, y, z);

    x -= dx;
    buffer += format( x, y, z);

    y -= dy;
    z -= 2*dz;
    buffer += format( x, y, z);

    x += 2*dx;
    z += dz;
    buffer += format( x, y, z);

    stream.write(buffer);
    return [x, y, z];
}

function knit(start, direction, bed){
    return tuck(start, direction, bed);
}

function xfer(fromSide, fromNeedle, toSide, toNeedle){

}

function newRow(start, currDir){
    start[1]+=boxSpacing;
    if(currDir == '-') start[0] -= boxWidth/6;
    else start[0] += boxWidth/6;
    return start;
}

//just for testing
function tests(){
    var start = [0,0,0];
    var bed = 'f';
    var direction = '-';

    stream.write(format(start[0], start[1], start[2]));
    for(var col = 0; col<10; col++){
        if(col%2==0)
            bed = 'f';
        else
            bed = 'b';
        start = tuck(start, '-', bed);
    }
    start = newRow(start, '-');
    for(var col = 0; col<10; col++){
        if(col%2==0)
            bed = 'b';
        else
            bed = 'f';
        start = knit(start, '+', bed);
    }
}

//main parser







tests();
