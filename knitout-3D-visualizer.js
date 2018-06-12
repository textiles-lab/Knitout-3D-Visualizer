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

function tuck(height, direction, bed, needle){
    var buffer = '';
    var dx = boxWidth/5;
    var dy =  boxHeight/3;
    var dz = boxDepth/2;
    var start = [-needle*boxWidth, height, 0];

    if(direction == '-') dx*= -1;
    else start[0] -= boxWidth;

    if(bed=='b'){
        dz*=-1;
        start[2] = -bedDistance;
    }else{
        start[2] = 0;
    }

    var x = start[0];
    var y = start[1];
    var z = start[2];

    activeRow.push([x, y, z]);

    x += 2*dx;
    z -= dz;
    activeRow.push([x, y, z]);

    y += dy;
    z += 2*dz;
    activeRow.push([x, y, z]);

    x -= dx;
    activeRow.push([x, y, z]);

    y += dy;
    activeRow.push([x, y, z]);

    x += dx;
    z -= 2*dz;
    activeRow.push([x, y, z]);

    x += dx;
    activeRow.push([x, y, z]);

    x += dx;
    z += 2*dz;
    activeRow.push([x, y, z]);

    y -= dy;
    activeRow.push([x, y, z]);

    x -= dx;
    activeRow.push([x, y, z]);

    y -= dy;
    z -= 2*dz;
    activeRow.push([x, y, z]);

    x += 2*dx;
    z += dz;
    activeRow.push([x, y, z]);

}

function knit(height, direction, bed, needle){
    tuck(height, direction, bed, needle);
}

function xfer(fromSide, fromNeedle, toSide, toNeedle){

}

function newRow(height, currDir){
    var buffer = '';
    for(var i = 0; i<activeRow.length; i++){
        var point = activeRow[i];
        buffer += format(point[0], point[1], point[2]);
    }
    stream.write(buffer);
    activeRow = [];

    height+=boxSpacing;
    return height;
}

//just for testing
function tests(){
    var height = 0;
    var bed = 'f';
    var direction = '-';

    for(var col = 0; col<10; col++){
        if(col%2==0)
            bed = 'f';
        else
            bed = 'b';
        tuck(height, '-', bed, col);
    }
    height = newRow(height, '-');

    for(var col = 9; col>=0; col--){
        if(col%2==0)
            bed = 'f';
        else
            bed = 'b';
        knit(height, '+', bed, col);
    }

    height = newRow(height, '+');

}

//main parser







tests();
