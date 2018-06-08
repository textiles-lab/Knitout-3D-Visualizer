#!/bin/sh
':' //; exec "$(command -v nodejs || command -v node)" "$0" "$@"
"use strict";

/*yarn-to-obj
 * Takes a file (.txt maybe) and turns it into an .obj file. Input file should
 * be a series of 3D coordinates with each component delineated by a space and
 * each new coordinate separated by a new line. The .obj should connect those
 * points into a long winding line representing a yarn path.
 */


//parse command line
if (process.argv.length != 4) {
    console.error("Usage:\nyarn-to-obj.js <in.txt> <out.obj>");
    process.exitCode = 1;
    return;
}
let inputFile = process.argv[2];
let objFile = process.argv[3];
const fs = require('fs');
//------------------------------------
function numberize(strings){
    for(var i = 0; i<strings.length; i++){
        strings[i] = parseFloat(strings[i].trim());
    }
    return strings;
}

function main(){
    //creating objFile
    var buffer = '';
    var points = fs.readFileSync(inputFile, 'utf8').trim().split('\n');
    //adds each coordinate
    for(var i = 0; i<points.length; i++){
       buffer+= 'v '+points[i]+'\n';
    }
    //adds each coordinate but slightly offset
    var offset = 0.01;
    for(var i = points.length-1; i>=0; i--){
        var comp = numberize(points[i].split(' '));
        var x = comp[0]+offset;
        var y = comp[1]+offset;
        var z = comp[2]+offset;
        buffer+= 'v '+x+' '+y+' '+z+' '+'\n';
    }

    //connect the dots
    for(var i = 1; i<points.length; i++){
        buffer+= 'f '+i+' '+(i+1)+' '
            +(2*points.length-i)+' '+(2*points.length-i+1)+'\n';
    }

    fs.writeFileSync(objFile, buffer);
}

main();
